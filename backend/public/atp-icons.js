/*!
 * ATP icon library — the six brand icons shared with the mobile app's
 * tab bar. Geometry is Lucide (lucide.dev, ISC license) outline icons:
 * 24×24 viewBox, stroke-based, stroke-width 2, round caps/joins,
 * currentColor so they inherit the surrounding text colour.
 *
 * Usage:
 *   element.innerHTML = ATPIcons.house;              // inline string
 *   node.appendChild(ATPIcons.el('calendarDays', 16)); // DOM element at 16px
 *
 * Dependency-free. Keep in sync with mobile/lib/components/icons/IconTab*.tsx.
 */
(function () {
  'use strict';

  var OPEN = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';

  function svg(inner) { return OPEN + inner + '</svg>'; }

  var icons = {
    // Home
    house: svg('<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
    // Sessions / calendar
    calendarDays: svg('<path d="M8 2v4"/><path d="M16 2v4"/><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M3 10h18"/><path d="M8 14h.01"/><path d="M12 14h.01"/><path d="M16 14h.01"/><path d="M8 18h.01"/><path d="M12 18h.01"/><path d="M16 18h.01"/>'),
    // Community / members
    users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'),
    // Store / cart
    shoppingBag: svg('<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>'),
    // Rewards
    gem: svg('<path d="M6 3h12l4 6-10 13L2 9Z"/><path d="M11 3 8 9l4 13 4-13-3-6"/><path d="M2 9h20"/>'),
    // Profile
    circleUser: svg('<circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v1.662"/>')
  };

  /**
   * Build a detached SVG element for an icon.
   * @param {string} name  key in ATPIcons (e.g. 'calendarDays')
   * @param {number} [size] rendered width/height in px (default 24)
   * @returns {Element|null}
   */
  icons.el = function (name, size) {
    var markup = icons[name];
    if (typeof markup !== 'string') return null;
    var host = document.createElement('div');
    host.innerHTML = markup;
    var node = host.firstElementChild;
    if (node && size) {
      node.setAttribute('width', String(size));
      node.setAttribute('height', String(size));
    }
    return node;
  };

  window.ATPIcons = icons;
})();
