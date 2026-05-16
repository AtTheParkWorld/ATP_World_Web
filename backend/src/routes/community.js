const router = require('express').Router();
const { query, transaction } = require('../db');
const { authenticate, requireAdmin, optionalAuth } = require('../middleware/auth');

// Rewrite any inline data: URL in a post's media array into a short
// /api/cms/media/<id> reference, migrating the raw bytes into a
// cms_content row on first read. Lazy migration — legacy posts that
// were created before the composer fix get cleaned up on demand
// without a separate cron, and new posts (which already store short
// refs) pass through unchanged in nanoseconds.
async function _rewriteInlineMedia(media) {
  if (!Array.isArray(media)) return media;
  let touched = false;
  const out = [];
  for (const m of media) {
    if (!m || typeof m !== 'object' || !m.src) { out.push(m); continue; }
    if (!String(m.src).startsWith('data:')) { out.push(m); continue; }
    try {
      const dataUrl = m.src;
      const isVideo = dataUrl.startsWith('data:video');
      const key = `community_legacy_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const r = await query(
        `INSERT INTO cms_content (page, section, key, value_url)
              VALUES ('_media', $1, $2, $3)
         ON CONFLICT (page, section, key) DO UPDATE SET value_url=$3
         RETURNING id`,
        [isVideo ? 'video' : 'image', key, dataUrl]
      );
      out.push({ ...m, src: `/api/cms/media/${r.rows[0].id}` });
      touched = true;
    } catch (e) {
      // If the migration write fails, fall back to original (still works,
      // just doesn't shrink the payload this time).
      out.push(m);
    }
  }
  return { media: out, touched };
}

async function _stripInlineFromPosts(rows) {
  // Walk posts in serial — typical feed is <30 rows and each row touches
  // at most 4 media items, so this is bounded. Persist the rewrite back
  // to the row so the next /feed call is a clean cache hit.
  for (const row of rows) {
    if (!row.media) continue;
    let parsed = row.media;
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed); } catch(e) { continue; } }
    if (!Array.isArray(parsed) || !parsed.length) continue;
    const hasInline = parsed.some(m => m && typeof m.src === 'string' && m.src.startsWith('data:'));
    if (!hasInline) { row.media = parsed; continue; }
    const result = await _rewriteInlineMedia(parsed);
    row.media = result.media;
    if (result.touched) {
      await query('UPDATE posts SET media=$1 WHERE id=$2', [JSON.stringify(result.media), row.id]).catch(()=>{});
    }
  }
  return rows;
}

// ── GET /api/community/feed ───────────────────────────────────
router.get('/feed', optionalAuth, async (req, res, next) => {
  try {
    const { limit = 20, before } = req.query;
    // Parameterise everything — member_id used to be interpolated into
    // the SQL string which, while not exploitable in practice (UUID
    // generated server-side), is the wrong shape. Build the param list
    // explicitly so each value is bound, including member_id.
    const params = [parseInt(limit, 10) || 20];
    const viewerId = req.member ? req.member.id : null;
    params.push(viewerId);                // $2 — may be null
    const memberParamIdx = params.length;
    let beforeClause = '';
    if (before) {
      params.push(before);
      beforeClause = `AND p.created_at < $${params.length}`;
    }

    const { rows } = await query(
      `SELECT p.id, p.content, p.media, p.likes_count, p.comments_count, p.created_at,
              m.id AS member_id, m.first_name, m.last_name, m.avatar_url,
              m.member_number, m.is_ambassador,
              CASE WHEN $${memberParamIdx}::uuid IS NULL THEN false
                   ELSE EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id=p.id AND pl.member_id=$${memberParamIdx}::uuid)
              END AS liked_by_me,
              t.name AS tribe_name
       FROM posts p
       JOIN members m ON m.id = p.member_id
       LEFT JOIN tribes t ON t.name = (m.sports_preferences->>0)
       WHERE p.is_deleted = false ${beforeClause}
       ORDER BY p.created_at DESC
       LIMIT $1`,
      params
    );
    await _stripInlineFromPosts(rows);
    res.json({ posts: rows });
  } catch (err) { next(err); }
});

// ── GET /api/community/me/posts (Theme 14) ────────────────────
// Member's own last 20 posts — used by the "My Posts" section on the
// profile page. Lighter than /feed: no joins needed across other
// members, but we do bring along the per-post likes_count and
// comments_count (already kept in sync on the row) plus liked_by_me
// so the heart toggle renders correctly.
router.get('/me/posts', authenticate, async (req, res, next) => {
  try {
    const limit = Math.min(50, parseInt(req.query.limit, 10) || 20);
    const { rows } = await query(
      `SELECT p.id, p.content, p.media, p.likes_count, p.comments_count, p.created_at,
              p.member_id, m.first_name, m.last_name, m.avatar_url,
              EXISTS(SELECT 1 FROM post_likes pl WHERE pl.post_id=p.id AND pl.member_id=$1) AS liked_by_me
       FROM posts p
       JOIN members m ON m.id = p.member_id
       WHERE p.member_id = $1 AND p.is_deleted = false
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [req.member.id, limit]
    );
    await _stripInlineFromPosts(rows);
    res.json({ posts: rows });
  } catch (err) { next(err); }
});

// ── POST /api/community/posts ─────────────────────────────────
router.post('/posts', authenticate, async (req, res, next) => {
  try {
    const { content, media = [] } = req.body;
    if (!content && !media.length) {
      return res.status(400).json({ error: 'Post must have content or media' });
    }

    const { rows } = await query(
      `INSERT INTO posts (member_id, content, media)
       VALUES ($1,$2,$3) RETURNING *`,
      [req.member.id, content, JSON.stringify(media)]
    );

    // Theme 14 — fan-out a notification to every accepted friend when
    // a member posts media (image or video). Text-only posts don't fire
    // (would be too noisy). Best-effort, fire-and-forget — failure here
    // must not affect the post creation.
    const hasMedia = Array.isArray(media) && media.length > 0;
    if (hasMedia) {
      const author = req.member;
      const authorName = ((author.first_name || '') + ' ' + (author.last_name || '')).trim() || 'A friend';
      const mediaKind = (media[0] && (media[0].type || media[0].kind)) || 'media';
      const niceKind = mediaKind === 'video' ? 'video' : (mediaKind === 'image' ? 'photo' : 'a new post');
      query(
        `INSERT INTO notifications (member_id, type, title, body, data)
         SELECT
           CASE WHEN f.requester_id = $1 THEN f.addressee_id ELSE f.requester_id END AS recipient,
           'friend_post',
           $2,
           $3,
           $4
         FROM friendships f
         WHERE f.status = 'accepted'
           AND (f.requester_id = $1 OR f.addressee_id = $1)`,
        [
          author.id,
          authorName + ' posted a new ' + niceKind,
          'Tap to see it in the community feed.',
          JSON.stringify({ post_id: rows[0].id, author_id: author.id, kind: niceKind }),
        ]
      ).catch(function(e){ console.warn('[community] friend_post notif fan-out failed', e.message); });
    }

    res.status(201).json({ post: rows[0] });
  } catch (err) { next(err); }
});

// ── DELETE /api/community/posts/:id ──────────────────────────
router.delete('/posts/:id', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT member_id FROM posts WHERE id=$1',
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Post not found' });

    if (rows[0].member_id !== req.member.id && !req.member.is_admin) {
      return res.status(403).json({ error: 'Not authorized to delete this post' });
    }

    await query(
      'UPDATE posts SET is_deleted=true, deleted_by=$1, deleted_at=NOW() WHERE id=$2',
      [req.member.id, req.params.id]
    );
    res.json({ message: 'Post deleted' });
  } catch (err) { next(err); }
});

// ── POST /api/community/posts/:id/like ───────────────────────
router.post('/posts/:id/like', authenticate, async (req, res, next) => {
  try {
    const { rows: existing } = await query(
      'SELECT 1 FROM post_likes WHERE post_id=$1 AND member_id=$2',
      [req.params.id, req.member.id]
    );

    if (existing.length) {
      // Unlike
      await query('DELETE FROM post_likes WHERE post_id=$1 AND member_id=$2',
        [req.params.id, req.member.id]);
      await query('UPDATE posts SET likes_count=likes_count-1 WHERE id=$1', [req.params.id]);
      res.json({ liked: false });
    } else {
      // Like
      await query('INSERT INTO post_likes (post_id, member_id) VALUES ($1,$2)',
        [req.params.id, req.member.id]);
      await query('UPDATE posts SET likes_count=likes_count+1 WHERE id=$1', [req.params.id]);
      // Theme 14 — notify the post author (only on the FIRST like from
      // this member to avoid notification spam if they like/unlike).
      // We never notify yourself for liking your own post.
      query(
        `INSERT INTO notifications (member_id, type, title, body, data)
         SELECT p.member_id, 'post_liked',
                COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), 'Someone') || ' liked your post',
                COALESCE(LEFT(p.content, 60), 'Tap to see your post.'),
                $3
         FROM posts p, members m
         WHERE p.id = $1 AND m.id = $2 AND p.member_id <> $2`,
        [req.params.id, req.member.id,
         JSON.stringify({ post_id: req.params.id, liker_id: req.member.id })]
      ).catch(function(e){ console.warn('[community] post_liked notif failed', e.message); });
      res.json({ liked: true });
    }
  } catch (err) { next(err); }
});

// ── GET /api/community/posts/:id/comments ────────────────────
router.get('/posts/:id/comments', optionalAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.content, c.likes_count, c.parent_id, c.created_at,
              m.id AS member_id, m.first_name, m.last_name, m.avatar_url
       FROM comments c
       JOIN members m ON m.id = c.member_id
       WHERE c.post_id=$1 AND c.is_deleted=false
       ORDER BY c.created_at ASC`,
      [req.params.id]
    );
    res.json({ comments: rows });
  } catch (err) { next(err); }
});

// ── POST /api/community/posts/:id/comments ───────────────────
router.post('/posts/:id/comments', authenticate, async (req, res, next) => {
  try {
    const { content, parent_id } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });

    const { rows } = await query(
      `INSERT INTO comments (post_id, member_id, content, parent_id)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [req.params.id, req.member.id, content, parent_id || null]
    );
    await query('UPDATE posts SET comments_count=comments_count+1 WHERE id=$1', [req.params.id]);

    // Theme 14 — notify the post author when someone comments on their
    // post. Never notify yourself for commenting on your own post.
    // Snippet of the comment is included in the notification body.
    query(
      `INSERT INTO notifications (member_id, type, title, body, data)
       SELECT p.member_id, 'post_commented',
              COALESCE(NULLIF(TRIM(m.first_name || ' ' || m.last_name), ''), 'Someone') || ' commented on your post',
              LEFT($3, 120),
              $4
       FROM posts p, members m
       WHERE p.id = $1 AND m.id = $2 AND p.member_id <> $2`,
      [req.params.id, req.member.id, content,
       JSON.stringify({ post_id: req.params.id, comment_id: rows[0].id, commenter_id: req.member.id })]
    ).catch(function(e){ console.warn('[community] post_commented notif failed', e.message); });

    res.status(201).json({ comment: rows[0] });
  } catch (err) { next(err); }
});

// ── POST /api/community/posts/:id/report ─────────────────────
router.post('/posts/:id/report', authenticate, async (req, res, next) => {
  try {
    const { reason, description } = req.body;
    if (!reason) return res.status(400).json({ error: 'Reason required' });

    await query(
      `INSERT INTO reports (reporter_id, target_type, target_id, reason, description)
       VALUES ($1,'post',$2,$3,$4) ON CONFLICT DO NOTHING`,
      [req.member.id, req.params.id, reason, description]
    );
    await query('UPDATE posts SET report_count=report_count+1 WHERE id=$1', [req.params.id]);
    res.json({ message: 'Report submitted' });
  } catch (err) { next(err); }
});

// ── GET /api/community/messages ───────────────────────────────
router.get('/messages', authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT cv.id, cv.last_message_at,
              CASE WHEN cv.member_a=$1 THEN m2.id ELSE m1.id END AS other_id,
              CASE WHEN cv.member_a=$1 THEN m2.first_name ELSE m1.first_name END AS other_first,
              CASE WHEN cv.member_a=$1 THEN m2.last_name ELSE m1.last_name END AS other_last,
              CASE WHEN cv.member_a=$1 THEN m2.avatar_url ELSE m1.avatar_url END AS other_avatar,
              (SELECT content FROM messages msg
               WHERE msg.conversation_id=cv.id
               ORDER BY msg.created_at DESC LIMIT 1) AS last_message,
              (SELECT COUNT(*) FROM messages msg
               WHERE msg.conversation_id=cv.id
                 AND msg.sender_id != $1
                 AND msg.read_at IS NULL) AS unread_count
       FROM conversations cv
       JOIN members m1 ON m1.id=cv.member_a
       JOIN members m2 ON m2.id=cv.member_b
       WHERE cv.member_a=$1 OR cv.member_b=$1
       ORDER BY cv.last_message_at DESC NULLS LAST`,
      [req.member.id]
    );
    res.json({ conversations: rows });
  } catch (err) { next(err); }
});

// ── GET /api/community/messages/:memberId ─────────────────────
router.get('/messages/:memberId', authenticate, async (req, res, next) => {
  try {
    const ids = [req.member.id, req.params.memberId].sort();
    const { rows: cvRows } = await query(
      `SELECT id FROM conversations WHERE member_a=$1 AND member_b=$2`,
      [ids[0], ids[1]]
    );

    if (!cvRows.length) return res.json({ messages: [] });

    const { rows } = await query(
      `SELECT msg.id, msg.content, msg.created_at, msg.read_at,
              msg.sender_id,
              m.first_name, m.last_name, m.avatar_url
       FROM messages msg
       JOIN members m ON m.id=msg.sender_id
       WHERE msg.conversation_id=$1
       ORDER BY msg.created_at ASC
       LIMIT 100`,
      [cvRows[0].id]
    );

    // Mark as read
    await query(
      `UPDATE messages SET read_at=NOW()
       WHERE conversation_id=$1 AND sender_id!=$2 AND read_at IS NULL`,
      [cvRows[0].id, req.member.id]
    );

    res.json({ messages: rows });
  } catch (err) { next(err); }
});

// ── POST /api/community/messages/:memberId ────────────────────
router.post('/messages/:memberId', authenticate, async (req, res, next) => {
  try {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Content required' });

    const targetId = req.params.memberId;
    const ids = [req.member.id, targetId].sort();

    const result = await transaction(async (client) => {
      // Get or create conversation
      let { rows: cvRows } = await client.query(
        `SELECT id FROM conversations WHERE member_a=$1 AND member_b=$2`,
        [ids[0], ids[1]]
      );
      let convId;
      if (!cvRows.length) {
        const { rows } = await client.query(
          `INSERT INTO conversations (member_a, member_b) VALUES ($1,$2) RETURNING id`,
          [ids[0], ids[1]]
        );
        convId = rows[0].id;
      } else {
        convId = cvRows[0].id;
      }

      const { rows: msgRows } = await client.query(
        `INSERT INTO messages (conversation_id, sender_id, content) VALUES ($1,$2,$3) RETURNING *`,
        [convId, req.member.id, content]
      );
      await client.query(
        'UPDATE conversations SET last_message_at=NOW() WHERE id=$1',
        [convId]
      );
      return msgRows[0];
    });

    res.status(201).json({ message: result });
  } catch (err) { next(err); }
});

module.exports = router;
