/*!
 * ATP — "Talk with us" floating WhatsApp CTA (2026-06-27)
 *
 * Self-mounts a bottom-right floating button on every page that loads
 * atp.bundle.min.js.  Clicking it opens wa.me with the ATP support
 * number prefilled.  Pure CSS for the hover-expand label so it's
 * lightweight + accessible.
 *
 * The icon is a placeholder inline SVG (WhatsApp glyph + lime ring).
 * When ChatGPT delivers the brand-custom icon as a 96×96 transparent
 * PNG, drop it into /public/atp-talk-icon.png and the renderer will
 * pick it up automatically.
 *
 * Hidden on /admin, /checkin, /stream-broadcast, and /auth-verify so
 * the button doesn't clutter operational / utility surfaces.
 */
(function () {
  if (window.__ATPTalkWithUs) return;
  window.__ATPTalkWithUs = true;

  var SKIP_PATHS = /^\/(admin|checkin|stream(-broadcast)?|auth\/verify|auth-verify)/i;
  if (SKIP_PATHS.test(location.pathname)) return;

  var WHATSAPP_URL = 'https://wa.me/971585792378?text=' +
    encodeURIComponent("Hi ATP! I'd like a quick question about " +
      (document.title || 'ATP') + '.');
  var PNG_ICON = '/atp-talk-icon.png'; // optional brand override

  function build() {
    if (document.getElementById('atp-talk-fab')) return;

    // Probe for the optional brand PNG.  If it exists we use it;
    // otherwise we fall back to the inline SVG below.
    var img = new Image();
    img.onload  = function() { mount({ usePng: true });  };
    img.onerror = function() { mount({ usePng: false }); };
    img.src = PNG_ICON + '?v=1';
  }

  function mount(opts) {
    if (document.getElementById('atp-talk-fab')) return;

    // Styles — inline so no per-page CSS dependency
    var st = document.createElement('style');
    st.id = 'atp-talk-fab-styles';
    st.textContent = [
      '#atp-talk-fab{',
      '  position:fixed;bottom:22px;right:22px;z-index:999;',
      '  display:flex;align-items:center;gap:0;',
      '  background:#A8FF00;border-radius:999px;',
      '  padding:0;height:56px;width:56px;overflow:hidden;',
      '  box-shadow:0 8px 24px -8px rgba(168,255,0,.55), 0 4px 16px rgba(0,0,0,.35);',
      '  cursor:pointer;text-decoration:none;color:#0a0a0a;',
      '  transition:width .26s cubic-bezier(.2,.7,.2,1), box-shadow .2s ease, transform .15s ease;',
      '  font-family:"Barlow Condensed", "DM Sans", sans-serif;',
      '  border:none;outline:none;',
      '}',
      '#atp-talk-fab:hover, #atp-talk-fab:focus-visible{',
      '  width:200px;',
      '  box-shadow:0 12px 32px -8px rgba(168,255,0,.7), 0 6px 18px rgba(0,0,0,.45);',
      '  transform:translateY(-1px);',
      '}',
      '#atp-talk-fab:active{transform:translateY(0)}',
      '#atp-talk-fab .atp-talk-icon{',
      '  width:56px;height:56px;flex-shrink:0;',
      '  display:flex;align-items:center;justify-content:center;',
      '}',
      '#atp-talk-fab .atp-talk-icon svg, #atp-talk-fab .atp-talk-icon img{',
      '  width:28px;height:28px;color:#0a0a0a;display:block;',
      '}',
      '#atp-talk-fab .atp-talk-label{',
      '  font-weight:800;font-size:14px;letter-spacing:.06em;text-transform:uppercase;',
      '  white-space:nowrap;opacity:0;transform:translateX(-6px);',
      '  transition:opacity .2s ease .04s, transform .22s cubic-bezier(.2,.7,.2,1) .04s;',
      '  padding-right:18px;',
      '}',
      '#atp-talk-fab:hover .atp-talk-label, #atp-talk-fab:focus-visible .atp-talk-label{',
      '  opacity:1;transform:translateX(0);',
      '}',
      '/* Gentle attention pulse — drops to none if the user prefers reduced motion */',
      '@keyframes atp-talk-pulse{',
      '  0%   {box-shadow:0 0 0 0 rgba(168,255,0,.55), 0 8px 24px -8px rgba(168,255,0,.55), 0 4px 16px rgba(0,0,0,.35)}',
      '  70%  {box-shadow:0 0 0 14px rgba(168,255,0,0),  0 8px 24px -8px rgba(168,255,0,.55), 0 4px 16px rgba(0,0,0,.35)}',
      '  100% {box-shadow:0 0 0 0 rgba(168,255,0,0),     0 8px 24px -8px rgba(168,255,0,.55), 0 4px 16px rgba(0,0,0,.35)}',
      '}',
      '#atp-talk-fab:not(:hover){animation:atp-talk-pulse 2.6s ease-out infinite}',
      '@media (prefers-reduced-motion: reduce){',
      '  #atp-talk-fab{animation:none;transition:none}',
      '  #atp-talk-fab .atp-talk-label{transition:none}',
      '}',
      '/* Phone tweak — pull off the system gesture bar a bit more */',
      '@media (max-width: 600px){',
      '  #atp-talk-fab{bottom:max(22px, env(safe-area-inset-bottom));right:16px}',
      '}',
    ].join('');
    document.head.appendChild(st);

    var iconHtml = opts.usePng
      ? '<img alt="" decoding="async" src="' + PNG_ICON + '">'
      :
      // Fallback inline SVG (WhatsApp glyph). Replaced automatically
      // if /atp-talk-icon.png ships later.
      '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        '<path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981zm11.387-5.464c-.074-.124-.272-.198-.57-.347-.297-.149-1.758-.868-2.031-.967-.272-.099-.47-.149-.669.149-.198.297-.768.967-.941 1.165-.173.198-.347.223-.644.074-.297-.149-1.255-.462-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.297-.347.446-.521.151-.172.2-.296.3-.495.099-.198.05-.371-.025-.52-.075-.149-.669-1.611-.916-2.206-.242-.579-.487-.501-.669-.51l-.57-.01c-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.095 3.2 5.076 4.487.709.306 1.263.489 1.694.626.712.226 1.36.194 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.695.248-1.29.173-1.414z"/>' +
      '</svg>';

    var a = document.createElement('a');
    a.id = 'atp-talk-fab';
    a.href = WHATSAPP_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('aria-label', 'Talk with us on WhatsApp');
    a.setAttribute('title', 'Talk with us on WhatsApp');
    a.innerHTML =
      '<span class="atp-talk-icon" aria-hidden="true">' + iconHtml + '</span>' +
      '<span class="atp-talk-label">Talk with us</span>';
    document.body.appendChild(a);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
