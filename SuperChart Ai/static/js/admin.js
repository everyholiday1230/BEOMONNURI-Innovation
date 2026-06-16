/*
 * Backward-compatible admin asset placeholder.
 * Admin dashboard logic is currently embedded in templates/admin.html for
 * initial render reliability; this file preserves the historical URL used by
 * monitors and older cached admin pages.
 */
(function () {
  'use strict';
  window.ChartOSAdmin = window.ChartOSAdmin || { assetLoaded: true };
})();
