/**
 * GET /p/:id — public post share page.
 *
 * No real DB: db.query is stubbed per test (routes/postShare.js reads it
 * at call time). Covers the OG tags a visible post renders, the generic
 * page for anything hidden / missing / malformed, and HTML escaping.
 */
// describe / it / expect / vi are injected as globals by Vitest.
const request = require('supertest');
const db = require('../src/db');
const app = require('../src/server');

const POST_ID = '3f2a9c1e-5b7d-4e8f-9a0b-1c2d3e4f5a6b';
const IPHONE  = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36';
const DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/128.0 Safari/537.36';
const WHATSAPP = 'WhatsApp/2.24.20.89 A';

function row(over = {}) {
  return {
    id: POST_ID,
    content: 'Sunrise run at Kite Beach 🌅 who is in tomorrow?',
    media: [{ src: 'https://pub-abc.r2.dev/post/2026-10/photo.jpeg', type: 'image' }],
    likes_count: 12,
    comments_count: 3,
    created_at: '2026-10-04T05:30:00Z',
    first_name: 'Sara',
    last_name: 'Khan',
    tribe_name: 'Runners',
    tribe_color: '#ff6a00',
    ...over,
  };
}

function stubPost(r) {
  return vi.spyOn(db, 'query').mockResolvedValue({ rows: r ? [r] : [] });
}

afterEach(() => vi.restoreAllMocks());

describe('GET /p/:id — visible post', () => {
  it('renders OG + Twitter tags from the post', async () => {
    const spy = stubPost(row());
    const res = await request(app).get('/p/' + POST_ID).set('User-Agent', DESKTOP);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/html/);
    expect(res.headers['x-robots-tag']).toBe('noindex');
    expect(res.headers['vary']).toMatch(/User-Agent/i);
    expect(res.text).toContain('<meta property="og:title" content="Sara on At The Park">');
    expect(res.text).toContain('<meta property="og:site_name" content="At The Park">');
    expect(res.text).toContain('<meta property="og:url" content="https://atthepark.world/p/' + POST_ID + '">');
    expect(res.text).toContain('<meta property="og:description" content="Sunrise run at Kite Beach 🌅 who is in tomorrow?">');
    expect(res.text).toContain('<meta property="og:image" content="https://pub-abc.r2.dev/post/2026-10/photo.jpeg">');
    expect(res.text).toContain('<meta name="twitter:card" content="summary_large_image">');
    // Counts + tribe render; only first name + last initial are shown.
    expect(res.text).toContain('Sara K.');
    expect(res.text).not.toContain('Khan');
    expect(res.text).toMatch(/Runners tribe/);
    // The lookup carries every visibility rule.
    const [sql, params] = spy.mock.calls[0];
    expect(params).toEqual([POST_ID]);
    expect(sql).toMatch(/p\.is_deleted = false/);
    expect(sql).toMatch(/is_banned/);
    expect(sql).toMatch(/pending_deletion_at IS NULL/);
    expect(sql).toMatch(/FROM reports r/);
  });

  it('gives WhatsApp the light branded image instead of a full-size photo', async () => {
    stubPost(row());
    const res = await request(app).get('/p/' + POST_ID).set('User-Agent', WHATSAPP);
    expect(res.status).toBe(200);
    expect(res.text).toContain('<meta property="og:image" content="https://atthepark.world/og-share.jpg">');
    expect(res.text).toContain('<meta property="og:image:width" content="1200">');
  });

  it('video post plays inline and falls back to the branded og:image', async () => {
    stubPost(row({ content: '', media: [{ src: 'https://pub-abc.r2.dev/post/2026-10/clip.mp4', type: 'video' }] }));
    const res = await request(app).get('/p/' + POST_ID).set('User-Agent', DESKTOP);
    expect(res.text).toMatch(/<video src="https:\/\/pub-abc\.r2\.dev\/post\/2026-10\/clip\.mp4#t=0\.1" controls playsinline/);
    expect(res.text).toContain('og:image" content="https://atthepark.world/og-share.jpg"');
    expect(res.text).toMatch(/og:description" content="A video from the At The Park community/);
  });

  it('picks app CTAs by user agent', async () => {
    stubPost(row());
    const ios = await request(app).get('/p/' + POST_ID).set('User-Agent', IPHONE);
    expect(ios.text).toContain('href="atp://community/post/' + POST_ID + '"');
    expect(ios.text).toContain('apps.apple.com/app/id6796708497');
    expect(ios.text).not.toContain('play.google.com');

    const android = await request(app).get('/p/' + POST_ID).set('User-Agent', ANDROID);
    expect(android.text).toContain('href="intent://community/post/' + POST_ID + '#Intent;scheme=atp;package=world.atthepark.app;');
    expect(android.text).toContain('play.google.com/store/apps/details?id=world.atthepark.app');
    expect(android.text).not.toContain('apps.apple.com');

    const desktop = await request(app).get('/p/' + POST_ID).set('User-Agent', DESKTOP);
    expect(desktop.text).not.toContain('Open in the app');
    expect(desktop.text).toContain('apps.apple.com/app/id6796708497');
    expect(desktop.text).toContain('play.google.com/store/apps/details?id=world.atthepark.app');
  });
});

describe('GET /p/:id — not shareable', () => {
  it('hidden / deleted / missing post → generic page, no content', async () => {
    stubPost(null);   // the visibility query filtered it out
    const res = await request(app).get('/p/' + POST_ID).set('User-Agent', DESKTOP);
    expect(res.status).toBe(404);
    expect(res.text).toContain("This post isn't");
    expect(res.text).toContain('<meta property="og:title" content="At The Park">');
    expect(res.text).toContain('og:image" content="https://atthepark.world/og-share.jpg"');
    expect(res.text).not.toContain(POST_ID);
    expect(res.text).not.toContain('Sara');
  });

  it('DB failure fails closed to the generic page', async () => {
    vi.spyOn(db, 'query').mockRejectedValue(new Error('connection refused'));
    const res = await request(app).get('/p/' + POST_ID);
    expect(res.status).toBe(503);
    expect(res.text).toContain("This post isn't");
  });

  it('malformed id never reaches the DB', async () => {
    const spy = vi.spyOn(db, 'query');
    const res = await request(app).get('/p/not-a-uuid');
    expect(res.status).toBe(404);
    expect(res.text).toContain("This post isn't");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('GET /p/:id — escaping', () => {
  it('escapes member content in the body and meta attributes', async () => {
    stubPost(row({
      content: '"><script>alert(1)</script> & <b>bold</b>',
      first_name: '<img src=x onerror=alert(2)>"',
      tribe_name: '</span><script>alert(3)</script>',
      tribe_color: 'red;}</style><script>alert(4)</script>',
      media: [
        { src: 'javascript:alert(5)', type: 'image' },
        { src: 'https://pub-abc.r2.dev/a.jpg"><script>alert(6)</script>', type: 'image' },
      ],
    }));
    const res = await request(app).get('/p/' + POST_ID).set('User-Agent', DESKTOP);
    expect(res.status).toBe(200);
    expect(res.text).not.toMatch(/<script>alert/);
    expect(res.text).not.toContain('<img src=x');
    expect(res.text).not.toContain('javascript:');
    expect(res.text).toContain('&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;b&gt;bold&lt;/b&gt;');
    expect(res.text).toContain('<meta property="og:title" content="&lt;img src=x onerror=alert(2)&gt;&quot; on At The Park">');
    // A non-hex tribe colour never reaches the style attribute.
    expect(res.text).toContain('style="--tc:#A8FF00"');
  });
});

describe('GET /api/community/posts/:id', () => {
  // Backs the app's post screen when a /p/:id link opens it cold.
  it('malformed id is a 404 without a DB call', async () => {
    const res = await request(app).get('/api/community/posts/not-a-uuid');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeTruthy();
  });
});
