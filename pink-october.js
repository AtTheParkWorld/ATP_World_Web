/* Pink October (founder 2026-10-16): the breast-cancer-awareness ribbon on
 * session cards and session pop-ups while it is October in Dubai. It
 * switches itself off on 1 November — nothing to remove by hand.
 *
 * Only sessions DATED in October carry it (founder 2026-10-30: none on
 * sessions from 1 November). Renderers mark those labels with the `pk`
 * class via window.atpPinkCls(scheduled_at); the CSS below draws the
 * ribbon on marked labels only:
 *   sessions page cards (.sc-tribe) and pop-up (.modal-tribe), homepage
 *   cards (.session-card .session-time), My sessions (.session-row
 *   .session-name), coach page cards (.cp-session-when), and the sessions
 *   page CALENDAR (the default view): the ribbon replaces the little tribe
 *   dot on each session pill, and on phones the "sessions this day" dot.
 */
(function () {
  var DUBAI = 4 * 3600000;                                 // UAE: UTC+4, no DST
  var now = new Date(Date.now() + DUBAI);
  var on = now.getUTCMonth() === 9;                        // October only
  // ' pk' for a session dated in this October (Dubai time), else ''.
  window.atpPinkCls = function (iso) {
    if (!on || !iso) return '';
    var t = Date.parse(iso);
    if (isNaN(t)) return '';
    var d = new Date(t + DUBAI);
    return d.getUTCMonth() === 9 && d.getUTCFullYear() === now.getUTCFullYear() ? ' pk' : '';
  };
  if (!on) return;
  document.documentElement.classList.add('pink-oct');
  var css =
    '.pink-oct .sc-tribe.pk::before,.pink-oct .modal-tribe.pk::before,' +
    '.pink-oct .session-card .session-time.pk::before,.pink-oct .session-row .session-name.pk::before,' +
    '.pink-oct .cp-session-when.pk::before{content:"";display:inline-block;flex:0 0 auto;width:11px;height:19px;' +
    'margin-right:7px;vertical-align:-5px;background:url(/img/pink-ribbon.png) center/contain no-repeat}' +
    '.pink-oct .cal-session-dot.pk::before{width:8px;height:13px;border-radius:0;box-shadow:none;margin-right:5px;' +
    'vertical-align:-3px;background:url(/img/pink-ribbon.png) center/contain no-repeat}' +
    '.pink-oct .cal-popover .cal-session-dot.pk::before{width:9px;height:15px;margin-right:7px;vertical-align:-3px}' +
    '@media(max-width:600px){.pink-oct .cal-day.has-session.pk::after{content:"";width:7px;height:12px;bottom:4px;' +
    'top:auto;right:auto;padding:0;border-radius:0;' +   // today's cell carries the TODAY-badge box styles
    'background:url(/img/pink-ribbon.png) center/contain no-repeat}}';
  var st = document.createElement('style');
  st.setAttribute('data-pink-october', '');
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
})();
