(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const THEME_KEY = 'mishkat.theme.v2';
  const topbar = $('#topbar');

  function readTheme() {
    try {
      const value = localStorage.getItem(THEME_KEY);
      if (!value) return 'dark';
      try {
        return JSON.parse(value) === 'light' ? 'light' : 'dark';
      } catch (_) {
        return value === 'light' ? 'light' : 'dark';
      }
    } catch (_) {
      return 'dark';
    }
  }

  function writeTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, JSON.stringify(theme));
    } catch (_) { /* private mode */ }
  }

  function applyTheme(theme) {
    const light = theme === 'light';
    document.body.classList.toggle('light-theme', light);
    const use = $('use', $('#theme-toggle'));
    if (use) use.setAttribute('href', light ? '#i-sun' : '#i-moon');
    $('#theme-toggle').title = light ? 'المظهر الفاتح' : 'المظهر الداكن';
    $('#theme-toggle').setAttribute('aria-label', light ? 'التبديل إلى المظهر الداكن' : 'التبديل إلى المظهر الفاتح');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#f4f1e9' : '#08090a');
    writeTheme(light ? 'light' : 'dark');
  }

  applyTheme(readTheme());

  $('#theme-toggle').addEventListener('click', () => {
    applyTheme(document.body.classList.contains('light-theme') ? 'dark' : 'light');
  });

  const onScroll = () => topbar?.classList.toggle('scrolled', window.scrollY > 12);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();
