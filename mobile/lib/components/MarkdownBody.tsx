/**
 * MarkdownBody — renders blog-flavoured markdown as native views.
 *
 * Founder 2026-08-30: "On the App the blog articles appear with ## and
 * ** instead of titles and bold fonts." The website converts the same
 * body text with a light markdown pass (blog-post.html renderBody);
 * this component mirrors those EXACT rules so a post reads the same on
 * both surfaces:
 *   - blocks split on blank lines
 *   - `## ` → H2, `### ` → H3
 *   - `> ` → blockquote (consecutive quote lines joined)
 *   - `---` → divider
 *   - `- ` / `* ` lines → bulleted list
 *   - inline: **bold**, *italic*, [text](url), ![alt](url)
 * If the body already contains HTML (admins may paste it), we strip
 * the tags to readable text — the app has no HTML engine, and a
 * tag-soup fallback beats raw angle brackets on screen.
 */
import React from 'react';
import { Image, Linking, Text, View } from 'react-native';
import { colors, fontFamily } from '@/lib/theme/tokens';
import { absUrl } from '@/lib/utils/imageUrl';

const HTML_RE = /<\/?(p|div|h[1-6]|ul|ol|li|img|video|iframe|figure|blockquote|pre|code|strong|em|a|br|hr|span)\b/i;

/** Inline markdown → nested <Text> runs. Handles **bold**, *italic*,
 *  [text](url). Images are handled at block level (RN can't inline
 *  an <Image> inside <Text> reliably). */
function renderInline(s: string, keyBase: string, baseColor: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Tokenize: links first, then bold, then italic — same precedence as web.
  const re = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|(^|[^*])\*([^*\n]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(s)) !== null) {
    // Italic match consumes one leading non-* char — put it back as text.
    const lead = m[4] || '';
    const start = m.index + (m[5] ? lead.length : 0);
    if (start > last) out.push(s.slice(last, start));
    if (m[1] !== undefined) {
      const url = m[2] || '';
      out.push(
        <Text
          key={`${keyBase}-l${i++}`}
          style={{ fontFamily: fontFamily.bodyBold, color: colors.green, textDecorationLine: 'underline' }}
          onPress={() => Linking.openURL(url).catch(() => {})}
        >
          {m[1]}
        </Text>
      );
    } else if (m[3] !== undefined) {
      out.push(
        <Text key={`${keyBase}-b${i++}`} style={{ fontFamily: fontFamily.bodyBold, color: baseColor }}>
          {m[3]}
        </Text>
      );
    } else if (m[5] !== undefined) {
      out.push(
        <Text key={`${keyBase}-i${i++}`} style={{ fontFamily: fontFamily.body, color: baseColor, fontStyle: 'italic' }}>
          {m[5]}
        </Text>
      );
    }
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out;
}

/** Strip inline image syntax out of a block, returning [textWithout, urls]. */
function extractImages(block: string): [string, string[]] {
  const urls: string[] = [];
  const text = block.replace(/!\[[^\]]*\]\(([^)\s]+)\)/g, (_all, url) => {
    urls.push(url);
    return '';
  });
  return [text.trim(), urls];
}

function stripHtml(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function MarkdownBody({ body }: { body: string }) {
  let raw = String(body || '').trim();
  if (!raw) return null;
  if (HTML_RE.test(raw)) raw = stripHtml(raw);

  const blocks = raw.split(/\n\s*\n/);
  return (
    <View>
      {blocks.map((block, bi) => {
        const t = block.trim();
        if (!t) return null;
        const key = `blk-${bi}`;
        const [text, images] = extractImages(t);

        const imgs = images.map((u, ii) => (
          <Image
            key={`${key}-img${ii}`}
            source={{ uri: absUrl(u) || u }}
            style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 12, backgroundColor: colors.dark2, marginBottom: 14 }}
            resizeMode="cover"
          />
        ));
        if (!text) return <View key={key}>{imgs}</View>;

        if (/^###\s+/.test(text)) {
          return (
            <View key={key}>
              {imgs}
              <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.white }} className="text-lg mt-4 mb-2">
                {renderInline(text.replace(/^###\s+/, ''), key, colors.white)}
              </Text>
            </View>
          );
        }
        if (/^##\s+/.test(text)) {
          return (
            <View key={key}>
              {imgs}
              <Text style={{ fontFamily: fontFamily.displayBlack, color: colors.white }} className="text-2xl uppercase tracking-tight mt-5 mb-2">
                {renderInline(text.replace(/^##\s+/, ''), key, colors.white)}
              </Text>
            </View>
          );
        }
        if (/^>\s+/.test(text)) {
          const quote = text.replace(/^>\s+/, '').replace(/\n>\s+/g, ' ');
          return (
            <View key={key} className="border-l-2 border-atp-green pl-4 my-3">
              {imgs}
              <Text style={{ fontFamily: fontFamily.body, color: colors.light, fontStyle: 'italic' }} className="text-base leading-relaxed">
                {renderInline(quote, key, colors.light)}
              </Text>
            </View>
          );
        }
        if (/^---+$/.test(text)) {
          return <View key={key} className="h-px bg-white/10 my-5" />;
        }
        if (/^[-*]\s+/.test(text)) {
          const items = text.split(/\n[-*]\s+/).map((l, i) => (i === 0 ? l.replace(/^[-*]\s+/, '') : l));
          return (
            <View key={key} className="mb-3">
              {imgs}
              {items.map((li, ii) => (
                <View key={`${key}-li${ii}`} className="flex-row mb-1.5">
                  <Text style={{ fontFamily: fontFamily.bodyBold, color: colors.green }} className="text-base mr-2">
                    ·
                  </Text>
                  <Text style={{ fontFamily: fontFamily.body, color: colors.white }} className="text-base leading-relaxed flex-1">
                    {renderInline(li.replace(/\n/g, ' '), `${key}-li${ii}`, colors.white)}
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <View key={key}>
            {imgs}
            <Text style={{ fontFamily: fontFamily.body, color: colors.white }} className="text-base leading-relaxed mb-3">
              {renderInline(text, key, colors.white)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
