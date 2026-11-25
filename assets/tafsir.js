/* المصحف والتفسير — صفحة المصحف في المنتصف وعمود التفسير بجوارها.
   يعيد استخدام بيانات تخطيط صفحات مصحف المدينة وملفات التفسير المحلية نفسها
   التي يستخدمها القارئ الرئيسي، دون تغيير أي خوارزمية من خوارزمياته. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const DEFAULT_QURAN_FONT_SIZE = 2.10;
  const THEME_KEY = 'mishkat.theme.v2';
  const FONT_KEY = 'mishkat.font.v5';
  const TAFSIR_SOURCES = ['التفسير الميسر', 'تفسير ابن كثير', 'تفسير السعدي', 'تفسير القرطبي', 'تفسير الطبري'];

  const state = {
    quran: [],
    verseToPage: [],
    page: 1,
    pageData: null,
    nextPageData: null,
    selected: null, // { s, a }
    source: TAFSIR_SOURCES[0],
    pageLayouts: new Map(),
    tafsirCache: new Map(),
    navSeq: 0,
    fontSize: DEFAULT_QURAN_FONT_SIZE,
    toastTimer: null,
    syncLockUntil: 0,
    observer: null
  };

  function readStorage(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) { return fallback; }
  }
  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private mode */ }
  }
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function toArabicDigits(value) {
    return String(value).replace(/[0-9]/g, digit => ARABIC_DIGITS[Number(digit)]);
  }
  function getSurah(id) { return state.quran.find(surah => Number(surah.id) === Number(id)); }
  function getVerse(surahId, ayahId) {
    const surah = getSurah(surahId);
    return surah?.array?.find(verse => Number(verse.id) === Number(ayahId));
  }
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  async function fetchJSON(path) {
    const response = await fetch(path, { cache: 'default' });
    if (!response.ok) throw new Error(`تعذر تحميل ${path} (${response.status})`);
    return response.json();
  }

  // Same lookup order as the main reader: dedicated Cache Storage bucket first
  // (so pages saved for offline reading work here too), then the local file,
  // then the public mirrors.
  async function loadMushafPage(pageNumber) {
    const page = Math.max(1, Math.min(604, Number(pageNumber)));
    if (state.pageLayouts.has(page)) return state.pageLayouts.get(page);
    const pad = String(page).padStart(3, '0');
    const localUrl = `./data/pages/page-${pad}.json`;
    const urls = [
      localUrl,
      `https://cdn.jsdelivr.net/gh/ouryhamdalaye/madinah-mushaf-json@main/pages/page-${pad}.json`,
      `https://raw.githubusercontent.com/ouryhamdalaye/madinah-mushaf-json/main/pages/page-${pad}.json`
    ];
    const request = (async () => {
      let cache = null;
      try { if ('caches' in window) cache = await caches.open('mishkat-mushaf-layout-v2'); } catch (_) { cache = null; }
      if (cache) {
        try {
          const cached = await cache.match(localUrl);
          if (cached) {
            const data = await cached.json();
            if (data?.page === page && Array.isArray(data.lines) && Array.isArray(data.verses)) return data;
          }
        } catch (_) { /* fall through to the network */ }
      }
      let lastError;
      for (const url of urls) {
        try {
          const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
          if (!response.ok) throw new Error(`تعذر تحميل صفحة المصحف ${page} (${response.status}).`);
          const data = await response.clone().json();
          if (data?.page !== page || !Array.isArray(data.lines) || !Array.isArray(data.verses)) throw new Error('بنية بيانات الصفحة غير صحيحة.');
          // Keep viewed pages in the shared offline bucket, like the main reader does.
          try { if (cache) await cache.put(url, response.clone()); } catch (_) { /* Cache storage is optional. */ }
          return data;
        } catch (error) { lastError = error; }
      }
      throw lastError || new Error('تعذر الوصول إلى بيانات تخطيط الصفحة.');
    })();
    state.pageLayouts.set(page, request);
    while (state.pageLayouts.size > 4) { const oldest = state.pageLayouts.keys().next().value; if (oldest === page) break; state.pageLayouts.delete(oldest); }
    try { return await request; }
    catch (error) { state.pageLayouts.delete(page); throw error; }
  }

  async function loadTafsirForSurah(surahId) {
    const sid = Number(surahId);
    if (state.tafsirCache.has(sid)) return state.tafsirCache.get(sid);
    const data = await fetchJSON(`data/tafsir/${String(sid).padStart(3, '0')}.json`);
    if (Number(data.number) !== sid || !Array.isArray(data.ayahs)) throw new Error('ملف التفسير لا يطابق السورة المطلوبة.');
    state.tafsirCache.set(sid, data);
    while (state.tafsirCache.size > 3) state.tafsirCache.delete(state.tafsirCache.keys().next().value);
    return data;
  }

  function firstPageToken(pageData) {
    if (!pageData?.lines) return null;
    for (const line of pageData.lines) {
      if (line.type === 'ayah-line' && line.tokens?.length) return line.tokens[0];
    }
    return null;
  }

  function renderMushafPage(pageData, nextPageData) {
    const wordLookup = new Map();
    const localWordFallback = new Map();
    pageData.verses.forEach(verse => {
      const key = `${verse.surah_number}:${verse.ayah_number}`;
      (verse.words || []).forEach(word => wordLookup.set(`${key}:${word.word_index}`, word.text));
    });
    const flatLines = (pageData.lines || []).map(line => line.type === 'ayah-line' ? (line.tokens || []) : []);
    const lastPageToken = [...flatLines].reverse().find(tokens => tokens.length)?.slice(-1)[0] || null;
    const nextPageFirst = firstPageToken(nextPageData);
    const lastCanClose = Number(pageData.page) === 604 || Boolean(nextPageFirst);
    const html = (pageData.lines || []).map((line, lineIndex) => {
      if (line.type === 'surah-header') {
        const nextTokens = flatLines.slice(lineIndex + 1).find(tokens => tokens.length);
        const firstToken = nextTokens?.[0];
        const sid = firstToken?.s;
        const basmala = firstToken && Number(firstToken.a) === 1 && Number(sid) !== 1 && Number(sid) !== 9
          ? '<div class="mushaf-basmala-line">بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</div>' : '';
        return `<div class="mushaf-surah-title-row"><span>${escapeHTML(line.text || '')}</span></div>${basmala}`;
      }
      if (line.type !== 'ayah-line' || !Array.isArray(line.tokens)) return '';
      const tokens = line.tokens;
      const words = tokens.map((token, tokenIndex) => {
        const key = `${token.s}:${token.a}`;
        let text = wordLookup.get(`${key}:${token.w}`);
        if (typeof text !== 'string' || !text) {
          if (!localWordFallback.has(key)) {
            const localVerse = getVerse(token.s, token.a);
            localWordFallback.set(key, String(localVerse?.ar || '').trim().split(/\s+/).filter(Boolean));
          }
          text = localWordFallback.get(key)[Number(token.w)] || '';
        }
        if (typeof text !== 'string' || !text) return '';
        let nextToken = tokens[tokenIndex + 1] || null;
        if (!nextToken) {
          const later = flatLines.slice(lineIndex + 1).find(items => items.length);
          nextToken = later?.[0] || (lastCanClose && token === lastPageToken ? (nextPageFirst || null) : null);
        }
        const closesAyah = Boolean(nextToken && `${nextToken.s}:${nextToken.a}` !== key) || (!nextToken && Number(pageData.page) === 604 && token === lastPageToken);
        const word = `<span class="ayah-unit" data-surah="${token.s}" data-ayah="${token.a}"><span class="quran-word" data-surah="${token.s}" data-ayah="${token.a}">${escapeHTML(text)}</span></span>`;
        const marker = closesAyah ? `<span class="verse-end" aria-label="نهاية الآية ${toArabicDigits(token.a)}">۝${toArabicDigits(token.a)}</span>` : '';
        return word + marker;
      }).join(' ');
      return `<div class="mushaf-line" data-line="${lineIndex + 1}">${words}</div>`;
    }).join('');
    $('#quran-content').innerHTML = html || '<div class="loading-state">لا تتوفر بيانات لهذه الصفحة.</div>';
  }

  function pageVerses(pageData) {
    const seen = new Set();
    const list = [];
    for (const verse of pageData?.verses || []) {
      const key = `${verse.surah_number}:${verse.ayah_number}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ s: Number(verse.surah_number), a: Number(verse.ayah_number) });
    }
    return list;
  }

  function tafsirForVerse(surahId, ayahId) {
    const surahTafsir = state.tafsirCache.get(Number(surahId));
    const entry = surahTafsir?.ayahs?.find(item => Number(item.ayah_number) === Number(ayahId));
    const text = entry?.tafsir?.find(item => item.type === state.source)?.text || '';
    return text.trim();
  }

  function renderTafsirEntries() {
    const host = $('#tafsir-entries');
    const verses = pageVerses(state.pageData);
    $('#tafsir-side-title').textContent = state.source;
    $('#tafsir-side-count').textContent = `${toArabicDigits(verses.length)} آية في الصفحة`;
    if (!verses.length) {
      host.innerHTML = '<p class="dashboard-note">لا توجد آيات في هذه الصفحة.</p>';
      return;
    }
    host.innerHTML = verses.map(({ s, a }) => {
      const surah = getSurah(s);
      const verse = getVerse(s, a);
      const tafsir = tafsirForVerse(s, a) || 'لا يتوفر نص مستقل لهذا الموضع في ملف المصدر؛ قد يكون الشرح متصلاً بالآية السابقة.';
      return `<article class="tafsir-entry" data-surah="${s}" data-ayah="${a}" id="tafsir-entry-${s}-${a}">
        <header><span class="tafsir-entry-ref">سورة ${escapeHTML(surah?.name || '')} · الآية ${toArabicDigits(a)}</span><span class="tafsir-entry-source">${escapeHTML(state.source)}</span></header>
        <p class="entry-verse" lang="ar" dir="rtl">${escapeHTML(verse?.ar || '')}</p>
        <p class="entry-tafsir">${escapeHTML(tafsir)}</p>
      </article>`;
    }).join('');
    markActiveEntry();
    observeEntries();
  }

  function markActiveEntry() {
    $$('.tafsir-entry').forEach(entry => {
      const active = state.selected && Number(entry.dataset.surah) === state.selected.s && Number(entry.dataset.ayah) === state.selected.a;
      entry.classList.toggle('active', Boolean(active));
    });
    $$('#quran-content .ayah-unit').forEach(unit => {
      const active = state.selected && Number(unit.dataset.surah) === state.selected.s && Number(unit.dataset.ayah) === state.selected.a;
      unit.classList.toggle('active-ayah', Boolean(active));
    });
  }

  function selectVerse(surahId, ayahId, scrollEntry = true) {
    state.selected = { s: Number(surahId), a: Number(ayahId) };
    markActiveEntry();
    if (scrollEntry) {
      const entry = $(`#tafsir-entry-${state.selected.s}-${state.selected.a}`);
      if (entry) {
        state.syncLockUntil = Date.now() + 700;
        entry.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  // Scrolling the tafsir column selects the verse whose card is at the top,
  // so the next verse's tafsir is reached by scrolling down.
  function observeEntries() {
    if (state.observer) state.observer.disconnect();
    const container = $('#tafsir-entries');
    if (!('IntersectionObserver' in window) || !container) return;
    state.observer = new IntersectionObserver(entries => {
      if (Date.now() < state.syncLockUntil) return;
      const visible = entries.filter(entry => entry.isIntersecting);
      if (!visible.length) return;
      const topMost = visible
        .map(entry => entry.target)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
      if (!topMost) return;
      const s = Number(topMost.dataset.surah);
      const a = Number(topMost.dataset.ayah);
      if (!state.selected || state.selected.s !== s || state.selected.a !== a) {
        state.selected = { s, a };
        markActiveEntry();
      }
    }, { root: container, rootMargin: '0px 0px -55% 0px', threshold: [0, 0.2, 0.6] });
    $$('.tafsir-entry', container).forEach(entry => state.observer.observe(entry));
  }

  async function goToPage(pageNumber, selectFirst = true) {
    const page = Math.max(1, Math.min(604, Number(pageNumber)));
    // Commit the target page before any await, so rapid next/previous clicks
    // stack on the newest page instead of all reading the same stale number,
    // and ignore renders that finish after a newer navigation started.
    const navSeq = (state.navSeq += 1);
    const isStale = () => state.navSeq !== navSeq;
    state.page = page;
    updatePageControls();
    $('#quran-content').innerHTML = '<div class="loading-state">جارٍ تحميل تخطيط صفحة المصحف...</div>';
    try {
      const [pageData, nextPageData] = await Promise.all([
        loadMushafPage(page),
        page < 604 ? loadMushafPage(page + 1).catch(() => null) : Promise.resolve(null)
      ]);
      if (isStale()) return;
      state.pageData = pageData;
      state.nextPageData = nextPageData;
      // Load the tafsir files of the surahs present on this page.
      const surahIds = [...new Set(pageVerses(pageData).map(verse => verse.s))];
      await Promise.all(surahIds.map(sid => loadTafsirForSurah(sid).catch(error => {
        console.info(`تعذر تحميل تفسير السورة ${sid}:`, error);
        return null;
      })));
      if (isStale()) return;
      renderMushafPage(pageData, nextPageData);
      renderTafsirEntries();
      const first = pageVerses(pageData)[0];
      if (selectFirst && first) selectVerse(first.s, first.a, false);
      updatePageControls();
    } catch (error) {
      if (isStale()) return;
      $('#quran-content').innerHTML = `<div class="empty-state">تعذّر تحميل صفحة المصحف. تحقق من اتصال الإنترنت ثم أعد المحاولة.<br><small>${escapeHTML(error.message)}</small></div>`;
      $('#tafsir-entries').innerHTML = '<p class="dashboard-note">تعذر تحميل التفسير لهذه الصفحة.</p>';
    }
  }

  function updatePageControls() {
    $('#page-number-input').value = String(state.page);
    $('#mushaf-page-number').textContent = toArabicDigits(state.page);
    $('#page-counter').textContent = `صفحة المصحف ${toArabicDigits(state.page)} من ٦٠٤`;
    $('#previous-page').disabled = state.page <= 1;
    $('#next-page').disabled = state.page >= 604;
  }

  function applyFontSize(size, notify = true) {
    const requested = Number(size);
    const safeSize = Number.isFinite(requested) ? requested : DEFAULT_QURAN_FONT_SIZE;
    state.fontSize = Number(Math.min(4.2, Math.max(1.4, safeSize)).toFixed(2));
    const zoom = Number((state.fontSize / DEFAULT_QURAN_FONT_SIZE).toFixed(3));
    document.documentElement.style.setProperty('--quran-zoom', String(zoom));
    writeStorage(FONT_KEY, state.fontSize);
    if (notify) showToast(`حجم خط المصحف: ${toArabicDigits(Math.round(zoom * 100))}٪`);
  }

  // Theme, matching the rest of the site.
  function readTheme() {
    try {
      const value = localStorage.getItem(THEME_KEY);
      if (!value) return 'dark';
      try { return JSON.parse(value) === 'light' ? 'light' : 'dark'; }
      catch (_) { return value === 'light' ? 'light' : 'dark'; }
    } catch (_) { return 'dark'; }
  }
  function applyTheme(theme) {
    const light = theme === 'light';
    document.body.classList.toggle('light-theme', light);
    const use = $('use', $('#theme-toggle'));
    if (use) use.setAttribute('href', light ? '#i-sun' : '#i-moon');
    $('#theme-toggle').title = light ? 'المظهر الفاتح' : 'المظهر الداكن';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#f4f1e9' : '#08090a');
    writeStorage(THEME_KEY, light ? 'light' : 'dark');
  }

  async function initialize() {
    applyTheme(readTheme());
    state.fontSize = Number(readStorage(FONT_KEY, DEFAULT_QURAN_FONT_SIZE)) || DEFAULT_QURAN_FONT_SIZE;
    applyFontSize(state.fontSize, false);
    const topbar = $('#topbar');
    const onScroll = () => topbar?.classList.toggle('scrolled', window.scrollY > 12);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();

    try {
      const [quran, verseToPage] = await Promise.all([
        fetchJSON('data/quran.json'),
        fetchJSON('data/verse-to-page.json')
      ]);
      if (!Array.isArray(quran) || quran.length !== 114) throw new Error('ملف القرآن لا يحتوي على السور الـ114 المتوقعة.');
      state.quran = quran;
      state.verseToPage = Array.isArray(verseToPage) && verseToPage.length === 604 ? verseToPage : [];
    } catch (error) {
      $('#quran-content').innerHTML = `<div class="empty-state">تعذّر تجهيز المصحف. تأكد من تشغيل الموقع عبر خادم محلي، ثم أعد تحميل الصفحة.<br><small>${escapeHTML(error.message)}</small></div>`;
      return;
    }

    $('#tafsir-surah-jump').innerHTML = state.quran.map(surah => `<option value="${surah.id}">${toArabicDigits(surah.id)} · ${escapeHTML(surah.name)}</option>`).join('');

    $('#quran-content').addEventListener('click', event => {
      const unit = event.target.closest('.ayah-unit');
      if (!unit) return;
      selectVerse(Number(unit.dataset.surah), Number(unit.dataset.ayah));
    });
    $('#tafsir-entries').addEventListener('click', event => {
      const entry = event.target.closest('.tafsir-entry');
      if (!entry) return;
      state.selected = { s: Number(entry.dataset.surah), a: Number(entry.dataset.ayah) };
      markActiveEntry();
    });
    $('#tafsir-source-select').addEventListener('change', event => {
      state.source = TAFSIR_SOURCES.includes(event.target.value) ? event.target.value : TAFSIR_SOURCES[0];
      renderTafsirEntries();
    });
    $('#tafsir-surah-jump').addEventListener('change', event => {
      const surahId = Number(event.target.value);
      const start = state.verseToPage.findIndex(item => Number(item.surah) === surahId);
      if (start >= 0) goToPage(start + 1);
      else showToast('تعذر تحديد صفحة بداية السورة.');
    });
    $('#previous-page').addEventListener('click', () => goToPage(state.page - 1));
    $('#next-page').addEventListener('click', () => goToPage(state.page + 1));
    $('#page-number-input').addEventListener('change', event => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) goToPage(value);
    });
    $('#page-number-input').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); $('#page-number-input').blur(); }
    });
    $('#font-larger').addEventListener('click', () => applyFontSize(state.fontSize + .15));
    $('#font-reset').addEventListener('click', () => applyFontSize(DEFAULT_QURAN_FONT_SIZE));
    $('#font-smaller').addEventListener('click', () => applyFontSize(state.fontSize - .15));
    $('#theme-toggle').addEventListener('click', () => applyTheme(document.body.classList.contains('light-theme') ? 'dark' : 'light'));

    const hashPage = Number((location.hash.match(/page=(\d+)/) || [])[1]);
    await goToPage(Number.isFinite(hashPage) && hashPage >= 1 ? hashPage : 1);
  }

  initialize();
})();
