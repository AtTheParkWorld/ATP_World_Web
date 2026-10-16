/* Pink October (founder 2026-10-16): the breast-cancer-awareness ribbon on
 * every session card and session pop-up while it is October in Dubai. It
 * switches itself off on 1 November — nothing to remove by hand. Pure CSS
 * on the existing labels, so no card markup changes:
 *   sessions page cards (.sc-tribe) and pop-up (.modal-tribe), homepage
 *   cards (.session-card .session-time), My sessions (.session-row
 *   .session-name), coach page cards (.cp-session-when).
 */
(function () {
  var dubai = new Date(Date.now() + 4 * 3600000);          // UAE: UTC+4, no DST
  if (dubai.getUTCMonth() !== 9) return;                   // October only
  document.documentElement.classList.add('pink-oct');
  var css =
    '.pink-oct .sc-tribe::before,.pink-oct .modal-tribe::before,' +
    '.pink-oct .session-card .session-time::before,.pink-oct .session-row .session-name::before,' +
    '.pink-oct .cp-session-when::before{content:"";display:inline-block;flex:0 0 auto;width:11px;height:19px;' +
    'margin-right:7px;vertical-align:-5px;background:url(/img/pink-ribbon.png) center/contain no-repeat}';
  var st = document.createElement('style');
  st.setAttribute('data-pink-october', '');
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
})();
