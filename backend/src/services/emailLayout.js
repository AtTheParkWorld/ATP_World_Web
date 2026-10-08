/**
 * ATP new-look email layout (founder 2026-10-08: refund emails must be
 * "properly branded with ATP new look and feel").
 *
 * Mirrors the approved Shopify receipt (atp-shopify/order-confirmation
 * .liquid) so a member sees one brand whether the email came from the
 * store or from the app: dark header with THE PARK logo, a lime rule,
 * a big condensed headline, a summary card, detail rows, a lime pill
 * button, the "Never Train Alone." band and a small footer.
 *
 * Email-client rules this follows:
 *   - tables + inline CSS only (Gmail strips most <style>), 600px max,
 *     stacks on phones;
 *   - Outlook (mso) fallbacks for fonts and button padding;
 *   - dark-first and marked color-scheme: dark, so Apple Mail / Gmail
 *     don't re-colour it, plus the Outlook.com [data-ogsc] fixes;
 *   - a hidden preheader (inbox preview line), alt text on the logo;
 *   - a plain-text twin built from the same data, for clients and spam
 *     filters that read text/plain.
 *
 * Every string passed in is treated as PLAIN TEXT and escaped here, so
 * callers can hand over member-typed values (names, session titles)
 * without thinking about HTML.
 *
 *   const { html, text } = renderEmail({
 *     preheader, eyebrow, headline, headlineAccent, greeting, intro,
 *     summary: { label, value, sub },
 *     rows: [{ label, value, mono }],
 *     notice: { title, text },
 *     cta: { label, url },
 *     footerNote,
 *   });
 */

// The light logo (white type, lime mark) on a transparent background —
// the header is dark, so the dark logo would disappear. Same file the
// Shopify receipt uses. Served from Shopify's CDN on purpose: the copy
// on atthepark.world goes out with helmet's Cross-Origin-Resource-
// Policy: same-origin, which mail apps that load images directly
// (Apple Mail, Outlook desktop) treat as "blocked". The PNG carries
// ~8.5% transparent padding left/right, which the header cell's
// padding compensates for so the mark lines up with the text.
const LOGO_URL = 'https://cdn.shopify.com/s/files/1/0973/0516/6126/files/atthepark_assets-02_689f165e-0cb7-440d-8f35-e1d7f386855f.png';
const SITE_URL = 'https://atthepark.world';
const WHATSAPP_URL = 'https://wa.me/971585792378';
const SUPPORT_EMAIL = 'general@atthepark.world';

const C = {
  bg:     '#0a0a0a',
  card:   '#141414',
  border: '#1f1f1f',
  lime:   '#A8FF00',
  white:  '#ffffff',
  muted:  '#9a9a9a',
  body:   '#d4d4d4',
};
const FONT_DISPLAY = "'Barlow Condensed','Arial Narrow',Impact,sans-serif";
const FONT_BODY = "'DM Sans','Helvetica Neue',Helvetica,Arial,sans-serif";

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Only http(s) links ever reach an href.
function safeUrl(u) {
  const s = String(u || '').trim();
  return /^https?:\/\//i.test(s) ? s : SITE_URL;
}

function _btn(label, url) {
  return `
              <table role="presentation" class="atp-btn" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                <tr>
                  <td class="atp-lime-bg" align="center" bgcolor="${C.lime}" style="border-radius:999px;background-color:${C.lime};mso-padding-alt:15px 32px;">
                    <a class="atp-on-lime" href="${esc(safeUrl(url))}" target="_blank" style="display:inline-block;padding:15px 32px;font-family:${FONT_BODY};font-size:14px;line-height:18px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#0a0a0a;text-decoration:none;border-radius:999px;">${esc(label)} &rarr;</a>
                  </td>
                </tr>
              </table>`;
}

function renderEmail(opts = {}) {
  const o = opts;
  const year = new Date().getFullYear();
  const rows = Array.isArray(o.rows) ? o.rows.filter((r) => r && r.value != null && r.value !== '') : [];

  // ── HTML ────────────────────────────────────────────────────
  const headline = esc(o.headline || '') +
    (o.headlineAccent ? ` <span class="atp-lime-text" style="color:${C.lime};">${esc(o.headlineAccent)}</span>` : '');

  const summaryHtml = o.summary ? `
          <tr>
            <td class="atp-px" style="padding:0 32px 16px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.border};border-radius:14px;border-collapse:separate;">
                <tr>
                  <td style="padding:24px 24px 22px 24px;">
                    <p style="margin:0 0 8px 0;font-family:${FONT_BODY};font-size:10px;line-height:14px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.muted};">${esc(o.summary.label || '')}</p>
                    <p class="atp-lime-text atp-amount" style="margin:0;font-family:${FONT_DISPLAY};font-size:46px;line-height:48px;font-weight:900;letter-spacing:-0.5px;text-transform:uppercase;color:${C.lime};">${esc(o.summary.value || '')}</p>
                    ${o.summary.sub ? `<p style="margin:10px 0 0 0;font-family:${FONT_BODY};font-size:14px;line-height:21px;color:${C.white};">${esc(o.summary.sub)}</p>` : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : '';

  const rowsHtml = rows.length ? `
          <tr>
            <td class="atp-px" style="padding:0 32px 16px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.card}" style="background-color:${C.card};border:1px solid ${C.border};border-radius:14px;border-collapse:separate;">
                <tr>
                  <td style="padding:8px 24px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="font-family:${FONT_BODY};font-size:14px;line-height:20px;">
                      ${rows.map((r, i) => `
                      <tr>
                        <td class="atp-row-label" valign="top" width="38%" style="padding:13px 12px 13px 0;${i ? `border-top:1px solid ${C.border};` : ''}color:${C.muted};">${esc(r.label)}</td>
                        <td class="atp-row-value" valign="top" align="right" style="padding:13px 0;${i ? `border-top:1px solid ${C.border};` : ''}color:${C.white};font-weight:700;${r.mono ? "font-family:'SFMono-Regular',Menlo,Consolas,monospace;font-size:12px;font-weight:400;word-break:break-all;" : ''}">${esc(r.value)}${r.hint ? `<br><span style="font-family:${FONT_BODY};font-size:12px;line-height:18px;font-weight:400;color:${C.muted};">${esc(r.hint)}</span>` : ''}</td>
                      </tr>`).join('')}
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : '';

  const noticeHtml = o.notice ? `
          <tr>
            <td class="atp-px" style="padding:0 32px 8px 32px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="atp-lime-border" style="padding:2px 0 2px 16px;border-left:3px solid ${C.lime};">
                    ${o.notice.title ? `<p style="margin:0 0 4px 0;font-family:${FONT_DISPLAY};font-size:18px;line-height:22px;font-weight:900;letter-spacing:0.5px;text-transform:uppercase;color:${C.white};">${esc(o.notice.title)}</p>` : ''}
                    <p style="margin:0;font-family:${FONT_BODY};font-size:14px;line-height:22px;color:${C.body};">${esc(o.notice.text || '')}</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>` : '';

  const ctaHtml = o.cta ? `
          <tr>
            <td class="atp-px" style="padding:24px 32px 8px 32px;">${_btn(o.cta.label, o.cta.url)}
            </td>
          </tr>` : '';

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html lang="en" xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no, address=no, email=no, date=no, url=no">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${esc(o.title || o.headline || 'At The Park')}</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <style>body, table, td, p, a, span, h1 { font-family: Arial, Helvetica, sans-serif !important; }</style>
  <![endif]-->
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@700;800;900&amp;family=DM+Sans:wght@400;500;700&amp;display=swap" rel="stylesheet">
  <style>
    :root { color-scheme: dark; supported-color-schemes: dark; }
    html, body { margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: ${C.bg}; }
    body { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { border: 0; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    a { text-decoration: none; }
    a[x-apple-data-detectors], u + #body a, #MessageViewBody a { color: inherit !important; text-decoration: none !important; font-size: inherit !important; font-family: inherit !important; font-weight: inherit !important; line-height: inherit !important; }
    /* Outlook.com / Office 365 dark mode: keep the brand colours */
    [data-ogsc] .atp-lime-text { color: ${C.lime} !important; }
    [data-ogsb] .atp-lime-bg { background-color: ${C.lime} !important; }
    [data-ogsc] .atp-on-lime { color: #0a0a0a !important; }
    @media only screen and (max-width: 620px) {
      .atp-container { width: 100% !important; max-width: 100% !important; }
      .atp-px { padding-left: 20px !important; padding-right: 20px !important; }
      .atp-logo-px { padding-left: 1px !important; padding-right: 20px !important; }
      .atp-h1 { font-size: 38px !important; line-height: 38px !important; }
      .atp-amount { font-size: 40px !important; line-height: 42px !important; }
      .atp-row-label, .atp-row-value { display: block !important; width: 100% !important; text-align: left !important; box-sizing: border-box; }
      .atp-row-label { padding-bottom: 2px !important; }
      .atp-row-value { padding-top: 0 !important; border-top: 0 !important; }
      .atp-btn { width: 100% !important; }
      .atp-btn a { display: block !important; }
    }
  </style>
</head>
<body id="body" style="margin:0;padding:0;background-color:${C.bg};" bgcolor="${C.bg}">

  <!-- Preheader (inbox preview text) -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;color:${C.bg};">
    ${esc(o.preheader || '')}
    &#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background-color:${C.bg};background-image:linear-gradient(${C.bg},${C.bg});">
    <tr>
      <td align="center" style="padding:24px 10px 40px 10px;">
        <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td><![endif]-->
        <table role="presentation" class="atp-container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">

          <!-- ═════ HEADER ═════ -->
          <tr>
            <td class="atp-logo-px" bgcolor="${C.bg}" style="padding:6px 32px 12px 13px;background-color:${C.bg};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <a href="${SITE_URL}" target="_blank" style="text-decoration:none;">
                      <img src="${LOGO_URL}" alt="THE PARK" width="220" style="display:block;width:220px;max-width:220px;height:auto;border:0;color:${C.white};font-family:${FONT_DISPLAY};font-size:26px;font-weight:900;">
                    </a>
                  </td>
                  ${o.headerLabel ? `<td align="right" valign="middle" style="font-family:${FONT_BODY};font-size:11px;line-height:16px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${C.muted};white-space:nowrap;">${esc(o.headerLabel)}</td>` : ''}
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td class="atp-lime-bg" bgcolor="${C.lime}" height="4" style="height:4px;line-height:4px;font-size:4px;background-color:${C.lime};mso-line-height-rule:exactly;">&nbsp;</td>
          </tr>

          <!-- ═════ HERO ═════ -->
          <tr>
            <td class="atp-px" bgcolor="${C.bg}" style="padding:36px 32px 24px 32px;background-color:${C.bg};">
              ${o.eyebrow ? `<p class="atp-lime-text" style="margin:0 0 14px 0;font-family:${FONT_BODY};font-size:11px;line-height:14px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:${C.lime};">&#9472;&#9472;&nbsp; ${esc(o.eyebrow)}</p>` : ''}
              <h1 class="atp-h1" style="margin:0 0 16px 0;font-family:${FONT_DISPLAY};font-size:46px;line-height:46px;font-weight:900;letter-spacing:-0.3px;text-transform:uppercase;color:${C.white};">${headline}</h1>
              ${o.greeting ? `<p style="margin:0 0 6px 0;font-family:${FONT_BODY};font-size:15px;line-height:24px;color:${C.white};font-weight:700;">${esc(o.greeting)}</p>` : ''}
              ${o.intro ? `<p style="margin:0;font-family:${FONT_BODY};font-size:15px;line-height:24px;color:${C.body};">${esc(o.intro)}</p>` : ''}
            </td>
          </tr>
${summaryHtml}
${rowsHtml}
${noticeHtml}
${ctaHtml}

          <!-- ═════ HELP ═════ -->
          <tr>
            <td class="atp-px" style="padding:24px 32px 36px 32px;">
              <p style="margin:0;font-family:${FONT_BODY};font-size:13px;line-height:21px;color:${C.muted};">
                Questions? Reply to this email or <a href="${WHATSAPP_URL}" target="_blank" class="atp-lime-text" style="color:${C.lime};text-decoration:none;font-weight:700;">message us on WhatsApp</a>. A real person from the team will get back to you.
              </p>
            </td>
          </tr>

          <!-- ═════ COMMUNITY BAND ═════ -->
          <tr>
            <td class="atp-px atp-lime-bg" bgcolor="${C.lime}" style="padding:30px 32px 28px 32px;background-color:${C.lime};">
              <p class="atp-on-lime" style="margin:0 0 6px 0;font-family:${FONT_BODY};font-size:11px;line-height:14px;font-weight:700;letter-spacing:3px;text-transform:uppercase;color:#0a0a0a;">ATP World &middot; Move together</p>
              <p class="atp-on-lime" style="margin:0 0 16px 0;font-family:${FONT_DISPLAY};font-size:36px;line-height:36px;font-weight:900;text-transform:uppercase;color:#0a0a0a;">Never Train Alone.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">
                <tr>
                  <td align="center" bgcolor="#0a0a0a" style="border-radius:999px;background-color:#0a0a0a;mso-padding-alt:12px 22px;">
                    <a href="${SITE_URL}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${FONT_BODY};font-size:13px;line-height:18px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#ffffff;text-decoration:none;border-radius:999px;">atthepark.world &rarr;</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- ═════ FOOTER ═════ -->
          <tr>
            <td class="atp-px" bgcolor="${C.bg}" style="padding:26px 32px 8px 32px;background-color:${C.bg};">
              <p style="margin:0 0 8px 0;font-family:${FONT_BODY};font-size:12px;line-height:18px;color:${C.muted};">
                <a href="${SITE_URL}" target="_blank" style="color:${C.white};text-decoration:none;font-weight:700;">atthepark.world</a>
                &nbsp;&middot;&nbsp; <a href="${WHATSAPP_URL}" target="_blank" style="color:${C.white};text-decoration:none;font-weight:700;">WhatsApp</a>
                &nbsp;&middot;&nbsp; <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.white};text-decoration:none;font-weight:700;">${SUPPORT_EMAIL}</a>
              </p>
              <p style="margin:0;font-family:${FONT_BODY};font-size:11px;line-height:17px;color:#6b6b6b;">
                &copy; ${year} At The Park &middot; Dubai, United Arab Emirates.${o.footerNote ? ' ' + esc(o.footerNote) : ''}
              </p>
            </td>
          </tr>

        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;

  // ── Plain text ──────────────────────────────────────────────
  const t = [];
  t.push('AT THE PARK');
  t.push('');
  if (o.eyebrow) t.push(String(o.eyebrow).toUpperCase());
  t.push(String((o.headline || '') + (o.headlineAccent ? ' ' + o.headlineAccent : '')).toUpperCase());
  t.push('');
  if (o.greeting) t.push(o.greeting);
  if (o.intro) { t.push(o.intro); }
  if (o.summary) {
    t.push('');
    t.push(`${o.summary.label}: ${o.summary.value}`);
    if (o.summary.sub) t.push(o.summary.sub);
  }
  if (rows.length) {
    t.push('');
    for (const r of rows) t.push(`${r.label}: ${r.value}${r.hint ? ' (' + r.hint + ')' : ''}`);
  }
  if (o.notice) {
    t.push('');
    t.push(o.notice.title ? `${o.notice.title}: ${o.notice.text}` : o.notice.text);
  }
  if (o.cta) {
    t.push('');
    t.push(`${o.cta.label}: ${safeUrl(o.cta.url)}`);
  }
  t.push('');
  t.push(`Questions? Reply to this email or message us on WhatsApp: ${WHATSAPP_URL}`);
  t.push('');
  t.push('Never Train Alone.');
  t.push(`${SITE_URL} · ${SUPPORT_EMAIL}`);
  t.push(`© ${year} At The Park · Dubai, United Arab Emirates.${o.footerNote ? ' ' + o.footerNote : ''}`);
  const text = t.join('\n');

  return { html, text };
}

module.exports = { renderEmail, LOGO_URL, SITE_URL, WHATSAPP_URL, SUPPORT_EMAIL };
