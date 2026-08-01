// watch-tabs.js — switches between the "Live Streams" and "Videos" tabs in
// the combined watch panel (see #watchPanel in index.html). Doesn't own any
// content itself — streams.js and videos.js each render into their own
// tabpanel independently of which one is currently visible, so switching
// tabs is just a matter of toggling which tabpanel is hidden and updating
// aria-selected/tabindex on the tab buttons. Follows the standard ARIA
// "tabs" pattern (https://www.w3.org/WAI/ARIA/apg/patterns/tabs/): only the
// active tab button is in the tab order, and Left/Right arrow keys move
// between tabs when one of them has focus.
(function (global) {
  "use strict";

  function init() {
    const tabs = Array.from(document.querySelectorAll(".watch-tab"));
    if (!tabs.length) return;

    function activate(tab, { focus = false } = {}) {
      tabs.forEach((t) => {
        const isActive = t === tab;
        t.classList.toggle("is-active", isActive);
        t.setAttribute("aria-selected", String(isActive));
        t.tabIndex = isActive ? 0 : -1;
        const panel = document.getElementById(t.getAttribute("aria-controls"));
        if (panel) panel.classList.toggle("hidden", !isActive);
      });
      if (focus) tab.focus();
    }

    tabs.forEach((tab, i) => {
      tab.addEventListener("click", () => activate(tab));
      tab.addEventListener("keydown", (e) => {
        if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
        e.preventDefault();
        const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
        activate(next, { focus: true });
      });
    });

    // Whichever tab already has .is-active in the markup (see index.html)
    // wins on load — no content re-render needed, streams.js/videos.js
    // already populate both tabpanels independently.
    const initial = tabs.find((t) => t.classList.contains("is-active")) || tabs[0];
    activate(initial);
  }

  global.WatchTabs = { init };
})(window);
