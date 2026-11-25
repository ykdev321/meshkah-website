(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const DEFAULT_QURAN_FONT_SIZE = 2.10;
  const STORAGE = {
    bookmarks: 'mishkat.bookmarks.v1',
    lastRead: 'mishkat.lastRead.v1',
    theme: 'mishkat.theme.v2',
    font: 'mishkat.font.v5',
    heardAyahs: 'mishkat.heardAyahs.v1',
    lastListened: 'mishkat.lastListened.v1',
    readPages: 'mishkat.readPages.v1',
    audioVolume: 'mishkat.audioVolume.v1',
    lastView: 'mishkat.lastView.v1'
  };

  const audio = $('#audio');
  const state = {
    quran: [],
    reciters: [],
    activeSurah: 1,
    activeAyah: 1,
    reciterId: null,
    libraryMode: 'surahs',
    timings: new Map(),
    chapterRows: [],
    bookmarks: readStorage(STORAGE.bookmarks, []),
    lastRead: readStorage(STORAGE.lastRead, null),
    translationVisible: false,
    clipEnd: null,
    clipJustEndedAyah: null,
    currentSource: null,
    isSeeking: false,
    toastTimer: null,
    fontSize: Number(readStorage(STORAGE.font, DEFAULT_QURAN_FONT_SIZE)) || DEFAULT_QURAN_FONT_SIZE,
    flatVerses: [], flatIndex: new Map(), pageStarts: [], pageIndex: 0, pageMapOfficial: false,
    pageEntries: [], pageLayouts: new Map(), currentPageLayout: null, pageRenderToken: 0, pageSyncPending: null, wordOverrides: new Map(),
    pageRepeat: false, repeatSegments: [], repeatSegmentIndex: 0, repeatTransitionPending: false, activeWordKey: null,
    focusMode: false, focusReturnScroll: 0,
    heardAyahs: new Set(readStorage('mishkat.heardAyahs.v1', [])),
    lastListened: readStorage('mishkat.lastListened.v1', null),
    lastCountedListenKey: null, isFullSurahPlaying: false, playerRepeat: false, playerAutoNext: true,
    tafsirCache: new Map(), tafsirPending: new Map(), tafsirIndex: null, hadiths: [], selectedHadith: 0, hadithCollectionId: 'nawawi', hadithCollectionName: 'الأربعون النووية', hadithCollectionCache: new Map(), dailyVerse: null,
    readPageRecords: readStorage('mishkat.readPages.v1', {}), lastConfirmedRead: null, previousVolume: 0.85,
  };
  if (!state.readPageRecords || Array.isArray(state.readPageRecords) || typeof state.readPageRecords !== 'object') state.readPageRecords = {};
  state.lastConfirmedRead = Object.values(state.readPageRecords).filter(item => item && Number.isFinite(Number(item.at))).sort((a,b)=>Number(b.at)-Number(a.at))[0] || null;

  const JUZ_STARTS = [1, 22, 42, 62, 82, 102, 121, 142, 162, 182, 201, 222, 242, 262, 282, 302, 322, 342, 362, 382, 402, 422, 442, 462, 482, 502, 522, 542, 562, 582];
  const ARABIC_ORDINAL = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن', 'التاسع', 'العاشر', 'الحادي عشر', 'الثاني عشر', 'الثالث عشر', 'الرابع عشر', 'الخامس عشر', 'السادس عشر', 'السابع عشر', 'الثامن عشر', 'التاسع عشر', 'العشرون', 'الحادي والعشرون', 'الثاني والعشرون', 'الثالث والعشرون', 'الرابع والعشرون', 'الخامس والعشرون', 'السادس والعشرون', 'السابع والعشرون', 'الثامن والعشرون', 'التاسع والعشرون', 'الثلاثون'];

  function readStorage(key, fallback) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) { return fallback; }
  }
  function writeStorage(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* private browsing or storage disabled */ }
  }
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function toArabicDigits(value) {
    return String(value).replace(/[0-9]/g, digit => ARABIC_DIGITS[Number(digit)]);
  }
  function normalizeArabic(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[ًٌٍَُِّْـ]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function getSurah(id) { return state.quran.find(surah => Number(surah.id) === Number(id)); }
  function getReciter() { return state.reciters.find(reciter => reciter.id === state.reciterId) || state.reciters[0]; }
  function getVerse(surahId, ayahId) {
    const surah = getSurah(surahId);
    return surah?.array?.find(verse => Number(verse.id) === Number(ayahId));
  }
  function isBookmarked(surahId, ayahId) {
    return state.bookmarks.some(item => Number(item.s) === Number(surahId) && Number(item.a) === Number(ayahId));
  }
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }
  function showReaderMessage(message) {
    const box = $('#reader-message');
    box.textContent = message;
    box.hidden = false;
  }
  function hideReaderMessage() { $('#reader-message').hidden = true; }

  const RECITER_HUES = [42, 158, 196, 28, 286, 104, 340, 218, 62, 178, 250, 12];
  function reciterHue(reciter) {
    const index = state.reciters.findIndex(item => item.id === reciter?.id);
    return RECITER_HUES[(index < 0 ? 0 : index) % RECITER_HUES.length];
  }
  function reciterInitial(reciter) {
    const name = String(reciter?.name_ar || 'ق').trim();
    return name.charAt(0) || 'ق';
  }
  function toWesternDigits(value) {
    return String(value).replace(/[٠-٩]/g, digit => ARABIC_DIGITS.indexOf(digit));
  }
  function updateHeroCard() { updateDashboardProgress(); }

  function reciterCardMarkup(reciter) {
    const active = reciter.id === state.reciterId;
    const timed = Boolean(reciter.timing?.word_file);
    return `<button class="reciter-chip ${active ? 'active' : ''}" data-reciter="${escapeHTML(reciter.id)}" aria-pressed="${active}">
      <span class="avatar" style="--hue:${reciterHue(reciter)}">${escapeHTML(reciterInitial(reciter))}</span>
      <span class="reciter-chip-copy"><strong>${escapeHTML(reciter.name_ar)}</strong><small>${escapeHTML(reciter.name_en || '')}</small></span>
      <span class="reciter-chip-badge ${timed ? 'timed' : ''}">${timed ? 'تزامن الكلمات' : 'صوت فقط'}</span>
      ${active ? '<svg class="check" aria-hidden="true"><use href="#i-check"/></svg>' : ''}
    </button>`;
  }

  function renderReciterPicker() {
    const container = $('#reciter-grid');
    if (!container) return;
    const timed = state.reciters.filter(reciter => reciter.timing?.word_file);
    const plain = state.reciters.filter(reciter => !reciter.timing?.word_file);
    const group = (title, note, items) => items.length ? `<div class="reciter-group">
      <div class="reciter-group-head"><span>${title}</span><small>${note}</small></div>
      <div class="reciter-grid-inner">${items.map(reciterCardMarkup).join('')}</div>
    </div>` : '';
    container.innerHTML = group('مع تزامن الكلمات', `${toArabicDigits(timed.length)} قرّاء`, timed) +
      group('تلاوات كاملة', `${toArabicDigits(plain.length)} قارئان`, plain);
  }

  function openReciterDialog() {
    renderReciterPicker();
    $('#reciter-dialog').hidden = false;
    document.body.classList.add('dialog-open');
    setTimeout(() => $('#reciter-dialog-close')?.focus(), 30);
  }
  function closeReciterDialog() {
    $('#reciter-dialog').hidden = true;
    document.body.classList.toggle('dialog-open', !$('#page-index-dialog').hidden || !$('#search-overlay').hidden);
    $('#reciter-picker-open')?.focus();
  }
  function chooseReciter(id) {
    const select = $('#reciter-select');
    if (!select) return;
    if (select.value !== id) {
      select.value = id;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    closeReciterDialog();
  }

  function renderPageIndex() {
    const container = $('#page-index-grid');
    if (!container) return;
    container.innerHTML = JUZ_STARTS.map((start, index) => {
      const end = index + 1 < JUZ_STARTS.length ? JUZ_STARTS[index + 1] - 1 : 604;
      const pages = Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
        .map(page => `<button class="page-btn" data-page="${page}" aria-label="الصفحة ${toArabicDigits(page)}">${toArabicDigits(page)}</button>`).join('');
      return `<section class="page-juz" data-juz="${index + 1}">
        <h3><span>الجزء ${ARABIC_ORDINAL[index]}</span><small>صفحة ${toArabicDigits(start)} – ${toArabicDigits(end)}</small></h3>
        <div class="page-grid">${pages}</div>
      </section>`;
    }).join('');
    updatePageIndexCurrent();
  }

  function updatePageIndexCurrent() {
    const current = state.pageIndex + 1;
    $$('.page-btn', $('#page-index-grid')).forEach(button => {
      const active = Number(button.dataset.page) === current;
      button.classList.toggle('current', active);
      if (active) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
  }

  function filterPageIndex(value) {
    const query = toWesternDigits(value).trim();
    $$('.page-juz', $('#page-index-grid')).forEach(section => {
      let visible = 0;
      $$('.page-btn', section).forEach(button => {
        const show = !query || String(button.dataset.page).includes(query) || toArabicDigits(button.dataset.page).includes(query);
        button.hidden = !show;
        if (show) visible++;
      });
      section.hidden = visible === 0;
    });
  }

  function openPageIndex() {
    renderPageIndex();
    const search = $('#page-index-search');
    if (search) search.value = '';
    $('#page-index-dialog').hidden = false;
    document.body.classList.add('dialog-open');
    setTimeout(() => search?.focus(), 40);
  }
  function closePageIndex() {
    $('#page-index-dialog').hidden = true;
    document.body.classList.toggle('dialog-open', !$('#reciter-dialog').hidden || !$('#search-overlay').hidden);
    $('#page-index-btn')?.focus();
  }
  async function choosePage(page) {
    closePageIndex();
    await goToPage(page);
  }

  function updateFocusBar() {
    const page = state.pageIndex + 1;
    const total = state.pageStarts.length || 604;
    const title = $('#focus-title-text');
    const input = $('#focus-page-input');
    const totalLabel = $('#focus-page-total');
    if (title) title.textContent = `الصفحة ${toArabicDigits(page)} من ${toArabicDigits(total)}`;
    if (input) { input.value = String(page); input.max = String(total); }
    if (totalLabel) totalLabel.textContent = `/ ${toArabicDigits(total)}`;
    const previous = $('#focus-prev');
    const next = $('#focus-next');
    if (previous) previous.disabled = page <= 1;
    if (next) next.disabled = page >= total;
    const fullscreen = $('#focus-fullscreen use');
    if (fullscreen) fullscreen.setAttribute('href', document.fullscreenElement ? '#i-collapse' : '#i-expand');
  }

  function setFocusMode(enabled) {
    state.focusMode = Boolean(enabled);
    document.body.classList.toggle('mushaf-focus', state.focusMode);
    const bar = $('#mushaf-focus-bar');
    if (bar) bar.hidden = !state.focusMode;
    if (state.focusMode) {
      state.focusReturnScroll = window.scrollY;
      document.body.classList.add('dialog-open');
      updateFocusBar();
      const stage = $('#mushaf-stage');
      if (stage) stage.scrollTop = 0;
      setTimeout(() => $('#focus-exit')?.focus(), 40);
    } else {
      document.body.classList.toggle('dialog-open', !$('#reciter-dialog').hidden || !$('#page-index-dialog').hidden || !$('#search-overlay').hidden);
      window.scrollTo({ top: state.focusReturnScroll || 0, behavior: 'auto' });
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
  }

  async function toggleBrowserFullscreen() {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch (_) {
      showToast('تعذّر تفعيل ملء الشاشة في هذا المتصفح؛ يمكنك الاستمرار في وضع العرض الكامل.');
    }
    updateFocusBar();
  }

  async function openMushafFullScreen() {
    if (!state.focusMode) setFocusMode(true);
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    } catch (_) {
      // Focus mode still fills the viewport when the browser blocks the Fullscreen API.
    }
    updateFocusBar();
  }

  function setLibraryOpen(open) {
    document.body.classList.toggle('library-open', Boolean(open));
    $('#mobile-menu')?.setAttribute('aria-expanded', String(Boolean(open)));
    const scrim = $('#library-scrim');
    if (scrim) scrim.hidden = !open;
  }

  async function fetchJSON(path) {
    const response = await fetch(path, { cache: 'default' });
    if (!response.ok) throw new Error(`تعذر تحميل ${path} (${response.status})`);
    return response.json();
  }

  async function initialize() {
    try {
      const [quran, recitersData] = await Promise.all([
        fetchJSON('data/quran.json'),
        fetchJSON('data/reciters.json')
      ]);
      try {
        if (document.fonts?.load) {
          const QuranFontSample = 'مَن جَآءَ بِٱلۡحَسَنَةِ فَلَهُۥ خَيۡرٞ مِّنۡهَا وَهُم مِّن فَزَعٖ يَوْمَئِذٍ ءَامِنُونَ';
          const quranFontLoads = Promise.allSettled([
            document.fonts.load('16px "Noto Naskh Arabic"', QuranFontSample),
            document.fonts.load('16px "Noto Naskh Arabic Local"', QuranFontSample)
          ]);
          // Never hold up the first Quran render for a slow font CDN. The
          // local/system fallback is immediate; the web font swaps in later.
          await Promise.race([
            quranFontLoads,
            new Promise(resolve => setTimeout(resolve, 600))
          ]);
        }
      } catch (fontError) {
        console.warn('Noto Naskh Arabic could not be preloaded; the installed Arabic Naskh fallback will be used.', fontError);
      }
      if (!Array.isArray(quran) || quran.length !== 114) throw new Error('ملف القرآن لا يحتوي على السور الـ114 المتوقعة.');
      state.quran = quran;
      state.reciters = recitersData.reciters || [];
      if (state.reciters.length < 12) throw new Error('قائمة القراء غير مكتملة.');
      if (state.reciters.some(reciter => reciter.riwayah !== 'hafs_an_asim')) throw new Error('تحتوي قائمة القراء على رواية غير حفص عن عاصم.');
      if (state.reciters.some(reciter => Object.keys(reciter.audio?.surah_urls || {}).length !== 114)) throw new Error('يوجد قارئ لا يحتوي على روابط السور الـ114 كاملة.');
      const ayahCount = state.quran.reduce((sum, surah) => sum + (surah.array?.length || 0), 0);
      if (ayahCount !== 6236) throw new Error(`عدد الآيات غير مطابق: ${ayahCount}`);

      state.flatVerses = state.quran.flatMap(surah => surah.array.map(verse => ({ surah, verse })));
      state.flatIndex = new Map(state.flatVerses.map((entry, index) => [`${entry.surah.id}:${entry.verse.id}`, index]));
      setFallbackPageStarts();
      state.reciterId = (state.reciters.find(reciter => reciter.id === 'nasser_al_qatami_mp3quran') || state.reciters[0]).id;
      const savedVolume = Number(readStorage(STORAGE.audioVolume, 0.85));
      audio.volume = Number.isFinite(savedVolume) ? Math.max(0, Math.min(1, savedVolume)) : 0.85;
      if ($('#studio-volume')) { $('#studio-volume').value = String(audio.volume); paintRangeFill($('#studio-volume')); }
      renderReciters();
      renderSurahList();
      renderPageIndex();
      updateBookmarkCount();
      applyTheme(readStorage(STORAGE.theme, 'dark'));
      applyFontSize(state.fontSize, false);
      updateHeroCard();

      const confirmedPosition = state.lastConfirmedRead;
      const launchTarget = document.body.classList.contains('player-standalone') ? readStorage('mishkat.playerLaunchTarget.v1', null) : null;
      if (document.body.classList.contains('player-standalone')) writeStorage('mishkat.playerLaunchTarget.v1', null);
      const launchSurah = Number(launchTarget?.s || 0);
      const launchAyah = Number(launchTarget?.a || 0);
      const lastView = readStorage(STORAGE.lastView, null);
      const resumeView = getVerse(lastView?.s, lastView?.a) ? lastView : confirmedPosition;
      const startSurahCandidate = getSurah(launchSurah) ? launchSurah : (getSurah(resumeView?.s) ? Number(resumeView.s) : 1);
      const startingSurah = startSurahCandidate;
      const startingAyahCandidate = getVerse(startingSurah, launchAyah) ? launchAyah : (getVerse(startingSurah, resumeView?.a) ? Number(resumeView.a) : 1);
      await openSurah(startingSurah, startingAyahCandidate, false);
      initializeDashboardControls();
      if (getVerse(lastView?.s, lastView?.a) && !document.body.classList.contains('player-standalone') && !launchTarget) setNavState('reader');
      updatePlayerLabels();
      updatePlayButton();
      if (document.body.classList.contains('player-standalone')) showDashboardView('player');
      registerServiceWorker();
      // Use the canonical Madinah Mushaf page starts when available. The reader remains usable if it is offline.
      loadOfficialPageMap().then(loaded => {
        if (loaded) { state.pageIndex = pageIndexForVerse(state.activeSurah, state.activeAyah); renderReader(); }
        requestPersistentStorage();
        // Download all 604 page layouts in the background, resume after interruption,
        // and keep them in a dedicated Cache Storage bucket across app updates.
        precacheAllMushafPages();
      });
    } catch (error) {
      console.error(error);
      $('#quran-content').innerHTML = `<div class="empty-state">تعذّر تجهيز المصحف. تأكد من تشغيل الموقع عبر خادم محلي، ثم أعد تحميل الصفحة.<br><small>${escapeHTML(error.message)}</small></div>`;
      $('#surah-list').innerHTML = '<div class="empty-state">تعذّر تحميل فهرس السور.</div>';
    }
  }

  function renderReciters() {
    const select = $('#reciter-select');
    if (select) {
      select.innerHTML = state.reciters.map(reciter =>
        `<option value="${escapeHTML(reciter.id)}">${escapeHTML(reciter.name_ar)}${reciter.timing?.word_file ? '' : ' — حفص (دون تظليل كلمات)'}</option>`
      ).join('');
      select.value = state.reciterId;
    }
    renderReciterPicker();
    updatePlayerLabels();
  }

  function renderSurahList() {
    const list = $('#surah-list');
    const search = normalizeArabic($('#surah-search').value);
    if (state.libraryMode === 'bookmarks') {
      renderBookmarkList(list);
      return;
    }
    const filtered = state.quran.filter(surah => {
      if (!search) return true;
      const text = normalizeArabic(`${surah.id} ${surah.name} ${surah.name_en} ${surah.name_translation}`);
      return text.includes(search);
    });
    if (!filtered.length && !search.length) {
      list.innerHTML = '<div class="empty-state">لا توجد سورة بهذا الاسم.</div>';
      return;
    }
    // The same field also searches inside the verse text, so typing a word
    // from an ayah lists the matching verses beneath the matching surahs.
    const verseMatches = [];
    if (search.length >= 2) {
      for (const surah of state.quran) {
        for (const verse of surah.array) {
          if (normalizeArabic(verse.ar).includes(search) || normalizeArabic(verse.en || '').includes(search)) {
            verseMatches.push({ surah, verse });
            if (verseMatches.length >= 20) break;
          }
        }
        if (verseMatches.length >= 20) break;
      }
    }
    if (!filtered.length && !verseMatches.length) {
      list.innerHTML = '<div class="empty-state">لا توجد سورة أو آية مطابقة.</div>';
      return;
    }
    const surahHtml = filtered.map(surah => `
      <button class="surah-item ${Number(surah.id) === state.activeSurah ? 'active' : ''}" data-open-surah="${surah.id}">
        <span class="surah-number"><span>${toArabicDigits(surah.id)}</span></span>
        <span class="surah-item-copy"><strong>${escapeHTML(surah.name)}</strong><small>${escapeHTML(surah.name_translation || surah.name_en || '')}</small></span>
        <span class="surah-item-meta">${toArabicDigits(surah.array.length)} آية</span>
      </button>`).join('');
    const verseHtml = verseMatches.length ? `
      <p class="dashboard-note library-verse-heading">آيات مطابقة</p>` + verseMatches.map(({ surah, verse }) => `
      <button class="surah-item saved-item" data-open-verse="${surah.id}:${verse.id}">
        <span class="surah-number"><span>${toArabicDigits(surah.id)}</span></span>
        <span class="surah-item-copy"><strong>${escapeHTML(surah.name)} · الآية ${toArabicDigits(verse.id)}</strong><small>${escapeHTML(verse.ar.slice(0, 60))}${verse.ar.length > 60 ? '…' : ''}</small></span>
        <span class="surah-item-meta">${toArabicDigits(verse.id)}</span>
      </button>`).join('') : '';
    list.innerHTML = surahHtml + verseHtml;
  }

  function renderBookmarkList(target) {
    const search = normalizeArabic($('#surah-search').value);
    const filteredBookmarks = state.bookmarks.filter(item => {
      const surah = getSurah(item.s);
      const verse = getVerse(item.s, item.a);
      if (!surah || !verse) return false;
      return !search || normalizeArabic(`${surah.name} ${surah.name_en} ${verse.ar} ${verse.en || ''} ${item.a}`).includes(search);
    });
    if (!filteredBookmarks.length) {
      target.innerHTML = '<div class="empty-state">لم تحفظ آيات بعد.<br>استخدم علامة الحفظ بجوار أي آية لتعود إليها لاحقًا.</div>';
      return;
    }
    target.innerHTML = filteredBookmarks.map(item => {
      const surah = getSurah(item.s);
      const verse = getVerse(item.s, item.a);
      if (!surah || !verse) return '';
      return `<button class="surah-item saved-item" data-open-verse="${item.s}:${item.a}">
        <span class="surah-number"><span>${toArabicDigits(item.s)}</span></span>
        <span class="surah-item-copy"><strong>${escapeHTML(surah.name)} · ${toArabicDigits(item.a)}</strong><small>${escapeHTML(verse.ar.slice(0, 55))}${verse.ar.length > 55 ? '…' : ''}</small></span>
        <span class="surah-item-meta">۞</span>
      </button>`;
    }).join('');
  }

  function updateBookmarkCount() {
    $('#bookmark-count').textContent = toArabicDigits(state.bookmarks.length);
  }

  function setFallbackPageStarts() {
    const count = 604;
    const total = state.flatVerses.length;
    state.pageStarts = Array.from({ length: count }, (_, i) => Math.min(total - 1, Math.round(i * total / count)));
    state.pageMapOfficial = false;
  }

  async function loadOfficialPageMap() {
    const cacheKey = 'mishkat.madinah-pages.v2';
    const urls = [
      './data/verse-to-page.json',
      'https://cdn.jsdelivr.net/gh/ouryhamdalaye/madinah-mushaf-json@main/pages/verse-to-page.json',
      'https://raw.githubusercontent.com/ouryhamdalaye/madinah-mushaf-json/main/pages/verse-to-page.json'
    ];
    try {
      let data = readStorage(cacheKey, null);
      if (!Array.isArray(data) || data.length !== 604) {
        let lastError;
        for (const url of urls) {
          try {
            const response = await fetch(url, { cache: 'force-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            data = await response.json();
            if (!Array.isArray(data) || data.length !== 604) throw new Error('ملف بدايات الصفحات غير مكتمل.');
            break;
          } catch (error) { lastError = error; }
        }
        if (!Array.isArray(data) || data.length !== 604) throw lastError || new Error('تعذر تحميل فهرس الصفحات.');
        writeStorage(cacheKey, data);
      }
      const starts = data.map(item => state.flatIndex.get(`${item.surah}:${item.ayah}`));
      if (starts.some(index => !Number.isInteger(index)) || starts[0] !== 0 || starts.some((value, i) => i > 0 && value <= starts[i - 1])) throw new Error('فهرس الصفحات لا يطابق نص القرآن المحلي.');
      state.pageStarts = starts;
      state.pageMapOfficial = true;
      return true;
    } catch (error) {
      console.info('Using approximate page boundaries until the official page map is available.', error);
      return false;
    }
  }

  async function loadMushafPage(pageNumber) {
    const page = Math.max(1, Math.min(604, Number(pageNumber)));
    if (state.pageLayouts.has(page)) return state.pageLayouts.get(page);
    const pad = String(page).padStart(3, '0');
    const urls = [
      `./data/pages/page-${pad}.json`,
      `https://cdn.jsdelivr.net/gh/ouryhamdalaye/madinah-mushaf-json@main/pages/page-${pad}.json`,
      `https://raw.githubusercontent.com/ouryhamdalaye/madinah-mushaf-json/main/pages/page-${pad}.json`
    ];
    const request = (async () => {
      const cacheKey = `mishkat-mushaf-layout-v2`;
      let cache = null;
      try { if ('caches' in window) cache = await caches.open(cacheKey); } catch (_) { cache = null; }
      let lastError;
      for (const url of urls) {
        try {
          if (cache) {
            const cached = await cache.match(url);
            if (cached) {
              const data = await cached.json();
              if (data?.page === page && Array.isArray(data.lines) && Array.isArray(data.verses)) return data;
            }
          }
          const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
          if (!response.ok) throw new Error(`تعذر تحميل صفحة المصحف ${page} (${response.status}).`);
          const data = await response.clone().json();
          if (data?.page !== page || !Array.isArray(data.lines) || !Array.isArray(data.verses)) throw new Error('بنية بيانات الصفحة غير صحيحة.');
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

  async function requestPersistentStorage() {
    try {
      if (navigator.storage?.persist) {
        const alreadyPersistent = await navigator.storage.persisted?.();
        if (!alreadyPersistent) await navigator.storage.persist();
      }
    } catch (error) {
      console.info('Persistent browser storage was not granted; cached pages may be evicted by the browser.', error);
    }
  }

  // Offline page download plan: page 1 is fetched first and awaited, then the
  // first 200 pages as the priority batch, then the remaining pages continue
  // in the background so the whole mushaf stays available offline.
  const OFFLINE_PRIORITY_PAGES = 200;
  const OFFLINE_CONTINUE_AFTER_PRIORITY = true;

  async function precacheAllMushafPages() {
    if (!('caches' in window) || !navigator.onLine) return;
    const completedKey = 'mishkat.mushaf-layout-cache.v2';
    if (readStorage(completedKey, null)?.complete === true) return;
    const cacheName = 'mishkat-mushaf-layout-v2';
    let cache;
    try { cache = await caches.open(cacheName); }
    catch (error) { console.info('Browser cache storage is unavailable; page layouts cannot be saved offline.', error); return; }
    const primary = page => `./data/pages/page-${String(page).padStart(3, '0')}.json`;
    const fallback = page => `https://raw.githubusercontent.com/ouryhamdalaye/madinah-mushaf-json/main/pages/page-${String(page).padStart(3, '0')}.json`;
    let completed = 0;
    let failed = 0;
    const lastPlannedPage = OFFLINE_CONTINUE_AFTER_PRIORITY ? 604 : OFFLINE_PRIORITY_PAGES;
    const order = [1, ...Array.from({ length: lastPlannedPage - 1 }, (_, index) => index + 2)];
    let cursor = 0;
    showToast(`يبدأ حفظ صفحات المصحف من الصفحة ١ ثم أول ${toArabicDigits(OFFLINE_PRIORITY_PAGES)} صفحة للاستخدام دون اتصال...`);
    async function cachePage(page) {
      const key = primary(page);
      try {
        const cached = await cache.match(key);
        if (cached) {
          const saved = await cached.clone().json();
          if (saved?.page === page && Array.isArray(saved.lines) && Array.isArray(saved.verses)) {
            completed++;
            return;
          }
        }
        let data = null;
        let lastError = null;
        for (const url of [key, fallback(page)]) {
          try {
            const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const candidate = await response.json();
            if (candidate?.page !== page || !Array.isArray(candidate.lines) || !Array.isArray(candidate.verses)) throw new Error('بيانات الصفحة غير مكتملة');
            data = candidate;
            break;
          } catch (error) { lastError = error; }
        }
        if (!data) throw lastError || new Error('تعذر تحميل الصفحة');
        await cache.put(key, new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } }));
        completed++;
        if (completed % 50 === 0 || completed === OFFLINE_PRIORITY_PAGES) { writeStorage(completedKey, { complete: false, pages: completed, failed, savedAt: new Date().toISOString() }); updateDashboardProgress(); console.info(`Mishkat offline pages cached: ${completed}/${lastPlannedPage}`); }
      } catch (error) {
        failed++;
        console.info(`Could not cache Mushaf page ${page}:`, error);
      }
    }
    async function worker() {
      while (cursor < order.length) {
        const page = order[cursor++];
        await cachePage(page);
      }
    }
    try {
      const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || {};
      const lowMemory = Number(navigator.deviceMemory || 4) <= 2;
      const slowNetwork = connection.saveData || ['slow-2g', '2g'].includes(connection.effectiveType);
      const workers = (lowMemory || slowNetwork) ? 1 : 2;
      // Page 1 is downloaded on its own first so it is ready immediately.
      await cachePage(order[cursor++]);
      await Promise.all(Array.from({ length: workers }, () => worker()));
      if (completed >= OFFLINE_PRIORITY_PAGES) {
        showToast(`اكتمل حفظ أول ${toArabicDigits(Math.min(completed, OFFLINE_PRIORITY_PAGES))} صفحة من المصحف للاستخدام دون اتصال.`);
      }
      if (completed === 604 && failed === 0) {
        writeStorage(completedKey, { complete: true, pages: 604, savedAt: new Date().toISOString() });
        showToast('اكتمل حفظ صفحات المصحف الـ604 للاستخدام دون اتصال.');
      } else {
        writeStorage(completedKey, { complete: false, pages: completed, failed, savedAt: new Date().toISOString() });
        if (completed < 604) showToast(`تم حفظ ${toArabicDigits(completed)} من ٦٠٤ صفحة؛ سيُستكمل الحفظ عند توفر الإنترنت.`);
      }
    } catch (error) {
      console.info('Mushaf page pre-caching interrupted; it will resume on the next visit.', error);
    }
  }

  function firstPageToken(pageData) {
    if (!pageData?.lines) return null;
    for (const line of pageData.lines) {
      if (line.type === 'ayah-line' && line.tokens?.length) return line.tokens[0];
    }
    return null;
  }

  function pageIndexForVerse(surahId, ayahId) {
    const flat = state.flatIndex.get(`${Number(surahId)}:${Number(ayahId)}`) ?? 0;
    let low = 0, high = state.pageStarts.length - 1, answer = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (state.pageStarts[mid] <= flat) { answer = mid; low = mid + 1; }
      else high = mid - 1;
    }
    return answer;
  }

  function getPageEntries(pageIndex = state.pageIndex) {
    const start = state.pageStarts[pageIndex] ?? 0;
    const end = state.pageStarts[pageIndex + 1] ?? state.flatVerses.length;
    return state.flatVerses.slice(start, end);
  }

  function updatePageControls() {
    const page = state.pageIndex + 1;
    const total = state.pageStarts.length || 604;
    $('#page-number-input').value = String(page);
    $('#page-number-input').max = String(total);
    $('#page-total').textContent = `/ ${toArabicDigits(total)}`;
    $('#page-counter').textContent = `${state.pageMapOfficial ? 'صفحة المصحف' : 'صفحة عرض'} ${toArabicDigits(page)} من ${toArabicDigits(total)}`;
    $('#mushaf-page-number').textContent = toArabicDigits(page);
    $('#previous-page').disabled = page <= 1;
    $('#next-page').disabled = page >= total;
    updateFocusBar();
    updatePageIndexCurrent();
    updateHeroCard();
    updatePageConfirmationControl();
  }

  function updatePageConfirmationControl() {
    const button = $('#confirm-page-read');
    if (!button) return;
    const page = String(state.pageIndex + 1);
    const confirmed = Boolean(state.readPageRecords[page]);
    button.classList.toggle('confirmed', confirmed);
    button.setAttribute('aria-pressed', String(confirmed));
    const label = $('span', button);
    if (label) label.textContent = confirmed ? 'تم تأكيد قراءة الصفحة' : 'أنهيت قراءة الصفحة';
    button.title = confirmed ? 'إلغاء تأكيد قراءة هذه الصفحة' : 'تأكيد أنك قرأت هذه الصفحة';
  }

  function markCurrentPageRead() {
    const page = String(state.pageIndex + 1);
    if (state.readPageRecords[page]) {
      delete state.readPageRecords[page];
      showToast('أُزيل تأكيد قراءة هذه الصفحة.');
    } else {
      state.readPageRecords[page] = { page: Number(page), s: state.activeSurah, a: state.activeAyah, at: Date.now() };
      showToast('تم حفظ تأكيد قراءة الصفحة على هذا الجهاز.');
    }
    writeStorage(STORAGE.readPages, state.readPageRecords);
    state.lastConfirmedRead = Object.values(state.readPageRecords).filter(item => item && Number.isFinite(Number(item.at))).sort((a,b)=>Number(b.at)-Number(a.at))[0] || null;
    state.lastRead = state.lastConfirmedRead ? { ...state.lastConfirmedRead, confirmed: true } : null;
    if (state.lastRead) writeStorage(STORAGE.lastRead, state.lastRead);
    else { try { localStorage.removeItem(STORAGE.lastRead); } catch (_) {} }
    updatePageConfirmationControl();
    updateDashboardProgress();
  }

  function renderReaderFallback() {
    const html = state.pageEntries.map(({ surah: itemSurah, verse }) => {
      const tokens = String(verse.ar || '').trim().split(/\s+/).filter(Boolean);
      const active = Number(itemSurah.id) === state.activeSurah && Number(verse.id) === state.activeAyah;
      const words = tokens.map((word, i) => {
        const index = i + 1;
        return `<span class="ayah-unit" data-surah="${itemSurah.id}" data-ayah="${verse.id}"><span class="quran-word ${active ? 'ayah-word-active' : ''}" data-surah="${itemSurah.id}" data-ayah="${verse.id}" data-word="${index}" data-sync="fallback">${escapeHTML(word)}</span></span>`;
      }).join(' ');
      return `<div class="mushaf-line fallback-line">${words}<span class="verse-end">۝${toArabicDigits(verse.id)}</span></div>`;
    }).join('');
    $('#quran-content').innerHTML = html || '<div class="loading-state">لا تتوفر بيانات لهذه الصفحة.</div>';
    $('#quran-content').classList.toggle('show-translation', state.translationVisible);
  }

  function renderExactMushafPage(pageData, nextPageData) {
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
          // The page layout and local Quran text are separate datasets. If a
          // layout word is absent, recover that exact zero-based word from the
          // bundled verse instead of silently omitting Quran text.
          if (!localWordFallback.has(key)) {
            const localVerse = getVerse(token.s, token.a);
            localWordFallback.set(key, String(localVerse?.ar || '').trim().split(/\s+/).filter(Boolean));
          }
          text = localWordFallback.get(key)[Number(token.w)] || '';
        }
        if (typeof text !== 'string' || !text) {
          console.error(`Missing Quran word in local and page data: ${key}:${token.w}`);
          return '';
        }
        let nextToken = tokens[tokenIndex + 1] || null;
        if (!nextToken) {
          const later = flatLines.slice(lineIndex + 1).find(items => items.length);
          nextToken = later?.[0] || (lastCanClose && token === lastPageToken ? (nextPageFirst || null) : null);
        }
        const closesAyah = Boolean(nextToken && `${nextToken.s}:${nextToken.a}` !== key) || (!nextToken && Number(pageData.page) === 604 && token === lastPageToken);
        const active = Number(token.s) === state.activeSurah && Number(token.a) === state.activeAyah;
        const timedIndex = Number(token.w) + 1; // Page-layout indexes are 0-based; QUD word timestamps are 1-based.
        const word = `<span class="ayah-unit ${active ? 'active-ayah' : ''}" data-surah="${token.s}" data-ayah="${token.a}"><span class="quran-word ${active ? '' : ''}" data-surah="${token.s}" data-ayah="${token.a}" data-word="${timedIndex}" data-sync="word">${escapeHTML(text)}</span></span>`;
        const marker = closesAyah ? `<span class="verse-end" aria-label="نهاية الآية ${toArabicDigits(token.a)}">۝${toArabicDigits(token.a)}</span>` : '';
        return word + marker;
      }).join(' ');
      return `<div class="mushaf-line" data-line="${lineIndex + 1}">${words}</div>`;
    }).join('');

    const translations = pageData.verses.map(item => {
      const surah = getSurah(item.surah_number);
      const verse = getVerse(item.surah_number, item.ayah_number);
      if (!verse?.en) return '';
      return `<div class="translation-row"><strong>${escapeHTML(surah?.name || '')} · ${toArabicDigits(item.ayah_number)}</strong><p>${escapeHTML(verse.en)}</p></div>`;
    }).join('');

    $('#quran-content').innerHTML = `${html}<div class="translation-panel">${translations}</div>`;
    $('#quran-content').classList.toggle('show-translation', state.translationVisible);
    state.currentPageLayout = pageData;
  }

  let viewTrackingReady = false;
  ['pointerdown', 'keydown', 'touchstart'].forEach(type => window.addEventListener(type, () => { viewTrackingReady = true; }, { once: true, passive: true }));
  function saveLastView() {
    if (!viewTrackingReady || !state.quran.length || !getVerse(state.activeSurah, state.activeAyah)) return;
    writeStorage(STORAGE.lastView, { s: state.activeSurah, a: state.activeAyah, p: state.pageIndex, at: Date.now() });
  }

  async function renderReader() {
    saveLastView();
    const surah = getSurah(state.activeSurah);
    if (!surah) return;
    const renderToken = ++state.pageRenderToken;
    const pageNumber = state.pageIndex + 1;
    state.pageEntries = getPageEntries();
    if (!state.pageEntries.length) return;
    const first = state.pageEntries[0];
    const last = state.pageEntries[state.pageEntries.length - 1];
    const firstSurah = first.surah;
    const lastSurah = last.surah;
    const headingText = firstSurah.id === lastSurah.id ? `سورة ${firstSurah.name}` : `من ${firstSurah.name} إلى ${lastSurah.name}`;
    $('#reader-location-text').textContent = `${firstSurah.name} · الصفحة ${toArabicDigits(pageNumber)}`;
    $('#surah-heading').innerHTML = `<span>${escapeHTML(headingText)} · مصحف المدينة · رواية حفص عن عاصم</span>`;
    $('#mushaf-basmalah').hidden = true;
    updatePageControls();
    renderSurahList();
    updatePlayerLabels();
    updateActiveVerseUI();
    if (!state.pageMapOfficial) {
      renderReaderFallback();
      state.currentPageLayout = null;
      return;
    }
    state.currentPageLayout = null;
    $('#quran-content').innerHTML = '<div class="loading-state">جارٍ تحميل تخطيط صفحة المصحف...</div>';
    try {
      const [pageData, nextPageData] = await Promise.all([
        loadMushafPage(pageNumber),
        pageNumber < 604 ? loadMushafPage(pageNumber + 1).catch(() => null) : Promise.resolve(null)
      ]);
      if (renderToken !== state.pageRenderToken) return;
      renderExactMushafPage(pageData, nextPageData);
      updateActiveVerseUI();
      paintActiveWord(audio.currentTime || 0);
    } catch (error) {
      if (renderToken !== state.pageRenderToken) return;
      console.warn('Mushaf page layout unavailable; using local text fallback.', error);
      renderReaderFallback();
      state.currentPageLayout = null;
      showReaderMessage('تعذر تحميل تخطيط الصفحة المطابق لمصحف المدينة. يعرض الموقع نص القرآن المحلي مؤقتًا؛ تحقق من اتصال الإنترنت لإعادة المحاولة.');
      updateActiveVerseUI();
      paintActiveWord(audio.currentTime || 0);
    }
    updatePageControls();
  }

  function getTimingRow(surahId, ayahId) {
    const rows = state.timings.get(state.reciterId)?.get(Number(surahId));
    return rows?.find(row => row.ayahId === Number(ayahId)) || null;
  }

  async function goToPage(pageNumber, scroll = true) {
    if (state.pageRepeat) stopPageRepeat();
    const index = Math.max(0, Math.min(state.pageStarts.length - 1, Number(pageNumber) - 1));
    const flat = state.pageStarts[index] ?? 0;
    const entry = state.flatVerses[flat];
    if (!entry) return;
    state.pageIndex = index;
    await openSurah(entry.surah.id, entry.verse.id, scroll);
    state.pageIndex = index;
    renderReader();
  }

  async function startPageRepeatSegment(index) {
    if (!state.pageRepeat || !state.repeatSegments.length) return;
    state.repeatSegmentIndex = index % state.repeatSegments.length;
    const segment = state.repeatSegments[state.repeatSegmentIndex];
    const repeatPageIndex = state.pageIndex;
    await openSurah(segment.s, segment.first, false);
    state.pageIndex = repeatPageIndex;
    renderReader();
    const rows = await ensureChapterTiming();
    const firstRow = rows.find(row => row.ayahId === segment.first);
    if (!firstRow || !Number.isFinite(segment.startMs) || !Number.isFinite(segment.endMs) || segment.endMs <= segment.startMs) {
      showReaderMessage(`تعذر تكرار هذا الجزء من الصفحة؛ لا تتوفر توقيتات كلمة موثوقة مع ${getReciter()?.name_ar}.`);
      stopPageRepeat();
      return;
    }
    await ensureAudioSource(segment.s);
    state.clipEnd = segment.endMs / 1000;
    setActiveVerse(segment.first, false);
    audio.currentTime = Math.max(0, segment.startMs / 1000);
    await audio.play();
    updatePlayButton();
  }

  async function advancePageRepeat() {
    if (!state.pageRepeat || state.repeatTransitionPending) return;
    state.repeatTransitionPending = true;
    try {
      await startPageRepeatSegment((state.repeatSegmentIndex + 1) % state.repeatSegments.length);
    } catch (error) {
      showReaderMessage(`تعذر متابعة تكرار الصفحة: ${error.message}`);
      stopPageRepeat();
    } finally { state.repeatTransitionPending = false; }
  }

  function stopPageRepeat() {
    state.pageRepeat = false;
    state.repeatSegments = [];
    state.clipEnd = null;
    $('#repeat-page').setAttribute('aria-pressed', 'false');
    $('#repeat-page').classList.remove('active');
  }

  async function togglePageRepeat() {
    if (state.pageRepeat) {
      stopPageRepeat();
      showToast('تم إيقاف تكرار الصفحة');
      return;
    }
    if (!state.pageMapOfficial) {
      showReaderMessage('تكرار الصفحة يحتاج إلى تحميل فهرس صفحات المصحف. تحقق من اتصال الإنترنت ثم أعد تحميل الموقع.');
      return;
    }
    try {
      const pageData = state.currentPageLayout || await loadMushafPage(state.pageIndex + 1);
      const tokens = (pageData.lines || []).flatMap(line => line.type === 'ayah-line' ? (line.tokens || []) : []);
      if (!tokens.length) throw new Error('لا توجد كلمات في تخطيط الصفحة.');
      const segments = [];
      for (const token of tokens) {
        let segment = segments[segments.length - 1];
        if (!segment || segment.s !== Number(token.s)) {
          segment = { s: Number(token.s), first: Number(token.a), last: Number(token.a), firstWord: Number(token.w) + 1, lastWord: Number(token.w) + 1 };
          segments.push(segment);
        } else {
          segment.last = Number(token.a);
          segment.lastWord = Number(token.w) + 1;
        }
      }
      const bySurah = await loadTiming();
      for (const segment of segments) {
        const rows = bySurah.get(segment.s) || [];
        const firstRow = rows.find(row => row.ayahId === segment.first);
        const lastRow = [...rows].reverse().find(row => row.ayahId === segment.last);
        const firstWord = firstRow?.words?.find(word => word.index === segment.firstWord);
        const lastWord = lastRow?.words?.find(word => word.index === segment.lastWord);
        if (!firstWord || !lastWord) throw new Error(`توقيت الكلمات غير مكتمل في سورة ${getSurah(segment.s)?.name || segment.s}.`);
        segment.startMs = firstWord.start;
        segment.endMs = lastWord.end;
      }
      state.repeatSegments = segments;
      state.pageRepeat = true;
      $('#repeat-page').setAttribute('aria-pressed', 'true');
      $('#repeat-page').classList.add('active');
      await startPageRepeatSegment(0);
      if (state.pageRepeat) showToast('تكرار الصفحة مفعّل');
    } catch (error) {
      stopPageRepeat();
      showReaderMessage(`تعذر تكرار الصفحة: ${error.message}`);
    }
  }

  async function openSurah(surahId, ayahId = 1, scroll = true) {
    const surah = getSurah(surahId);
    if (!surah) return;
    if (Number(surahId) !== state.activeSurah) {
      audio.pause();
      state.clipEnd = null;
      state.currentSource = null;
      audio.removeAttribute('src');
      audio.load();
      updatePlayButton();
    }
    state.activeSurah = Number(surahId);
    state.activeAyah = getVerse(surahId, ayahId) ? Number(ayahId) : 1;
    state.pageIndex = pageIndexForVerse(state.activeSurah, state.activeAyah);
    hideReaderMessage();
    state.chapterRows = state.timings.get(state.reciterId)?.get(state.activeSurah) || [];
    renderReader();
    if (scroll) setTimeout(() => scrollToVerse(state.activeSurah, state.activeAyah, 'center'), 240);
    if (state.libraryMode === 'surahs') renderSurahList();
    updatePlayButton();
    updateDashboardProgress();
    renderSurahInformation(state.activeSurah);
  }

  function scrollToVerse(surahId, ayahId, block = 'center') {
    const el = $(`.ayah-unit[data-surah="${Number(surahId)}"][data-ayah="${Number(ayahId)}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block });
  }

  function setActiveVerse(ayahId, scroll = false) {
    const verse = getVerse(state.activeSurah, ayahId);
    if (!verse) return;
    state.activeAyah = Number(ayahId);
    updateActiveVerseUI();
    updateDashboardProgress();
    if (scroll) scrollToVerse(state.activeSurah, state.activeAyah);
  }

  function updateActiveVerseUI() {
    $$('.ayah-unit').forEach(unit => unit.classList.toggle('active-ayah', Number(unit.dataset.surah) === state.activeSurah && Number(unit.dataset.ayah) === state.activeAyah));
    $('#reader-location-text').textContent = `${getSurah(state.activeSurah)?.name || ''} · الآية ${toArabicDigits(state.activeAyah)} · الصفحة ${toArabicDigits(state.pageIndex + 1)}`;
    updateHeroCard();
  }

  async function decompressGzip(buffer) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('المتصفح لا يدعم فك ضغط ملفات التوقيت. استخدم إصدارًا حديثًا من Chrome أو Firefox.');
    }
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).text();
  }

  async function loadTiming(reciter = getReciter()) {
    if (!reciter) throw new Error('لم يتم اختيار قارئ.');
    if (state.timings.has(reciter.id)) return state.timings.get(reciter.id);
    const timingPath = reciter.timing?.word_file;
    if (!timingPath) throw new Error('لا يوجد ملف توقيت لهذا القارئ.');
    const response = await fetch(timingPath);
    if (!response.ok) throw new Error(`تعذر تحميل توقيتات ${reciter.name_ar}.`);
    const raw = await decompressGzip(await response.arrayBuffer());
    const parsed = JSON.parse(raw);
    const rows = (parsed.rows || []).filter(row => row[3] === true).map(row => {
      const [ref, start, end, canonical, silenceAfter, words] = row;
      const [surahId, ayahId] = ref.split(':').map(Number);
      return {
        ref, surahId, ayahId, start, end, canonical, silenceAfter,
        words: Array.isArray(words) ? words.map(item => ({ index: Number(item[0]), start: Number(item[1]), end: Number(item[2]) })) : []
      };
    });
    const bySurah = new Map();
    rows.forEach(row => {
      if (!bySurah.has(row.surahId)) bySurah.set(row.surahId, []);
      bySurah.get(row.surahId).push(row);
    });
    bySurah.forEach(group => group.sort((a, b) => a.start - b.start));
    state.timings.set(reciter.id, bySurah);
    // Keep timing JSON in RAM for at most two reciters; Cache Storage/browser HTTP cache handles later reloads.
    while (state.timings.size > 2) { const oldest = state.timings.keys().next().value; if (oldest === reciter.id) break; state.timings.delete(oldest); }
    return bySurah;
  }

  async function ensureChapterTiming() {
    try {
      const bySurah = await loadTiming();
      state.chapterRows = bySurah.get(state.activeSurah) || [];
      renderReader();
      return state.chapterRows;
    } catch (error) {
      state.chapterRows = [];
      showReaderMessage(`${error.message} ستظل التلاوة الكاملة متاحة، لكن مزامنة الكلمات لن تعمل لهذا القارئ.`);
      return [];
    }
  }

  function getAudioUrl(surahId = state.activeSurah) {
    const reciter = getReciter();
    return reciter?.audio?.surah_urls?.[String(surahId)] || null;
  }

  function waitForAudioMetadata() {
    if (audio.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('انتهت مهلة انتظار ملف الصوت.')), 18000);
      const loaded = () => finish();
      const failed = () => finish(new Error('تعذر الوصول إلى ملف الصوت من خادم التلاوة.'));
      function finish(error) {
        clearTimeout(timer);
        audio.removeEventListener('loadedmetadata', loaded);
        audio.removeEventListener('error', failed);
        error ? reject(error) : resolve();
      }
      audio.addEventListener('loadedmetadata', loaded, { once: true });
      audio.addEventListener('error', failed, { once: true });
    });
  }

  async function ensureAudioSource(surahId = state.activeSurah) {
    const url = getAudioUrl(surahId);
    if (!url) throw new Error('لا يوجد رابط صوتي لهذه السورة مع القارئ المحدد.');
    if (state.currentSource !== url) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      state.currentSource = url;
      audio.src = url;
      audio.load();
    }
    await waitForAudioMetadata();
    return url;
  }

  async function playSurah() {
    hideReaderMessage();
    state.isFullSurahPlaying = true;
    if (state.pageRepeat) stopPageRepeat();
    await openSurah(state.activeSurah, 1, false);
    await ensureChapterTiming();
    try {
      await ensureAudioSource(state.activeSurah);
      state.clipEnd = null;
      setActiveVerse(1, false);
      await audio.play();
      updatePlayerLabels();
      updatePlayButton();
      showToast(`بدأت تلاوة سورة ${getSurah(state.activeSurah).name}`);
    } catch (error) {
      showReaderMessage(`تعذر بدء التلاوة: ${error.message} تحقق من اتصال الإنترنت أو جرّب قارئًا آخر.`);
      updatePlayButton();
    }
  }

  async function downloadCurrentSurahAudio() {
    const surah = getSurah(state.activeSurah);
    const reciter = getReciter();
    const url = getAudioUrl(state.activeSurah);
    if (!surah || !reciter || !url) {
      showToast('لا يتوفر رابط صوتي للسورة والقارئ المحددين.');
      return;
    }
    const safeSurah = String(surah.name || `surah-${state.activeSurah}`).replace(/[\\/:*?"<>|]/g, '-').trim();
    const safeReciter = String(reciter.name_ar || reciter.id).replace(/[\\/:*?"<>|]/g, '-').trim();
    const filename = `${String(state.activeSurah).padStart(3, '0')}-${safeSurah}-${safeReciter}.mp3`;
    const button = $('#download-surah-audio');
    button.disabled = true;
    button.classList.add('loading');
    try {
      // On browsers that support the File System Access API, stream the MP3
      // straight to disk. This avoids loading large surah files into RAM.
      if (typeof window.showSaveFilePicker === 'function') {
        try {
          const handle = await window.showSaveFilePicker({
            suggestedName: filename,
            types: [{ description: 'ملف صوتي MP3', accept: { 'audio/mpeg': ['.mp3'] } }]
          });
          const response = await fetch(url, { mode: 'cors' });
          if (!response.ok || !response.body) throw new Error(`تعذر جلب الملف الصوتي (${response.status || 'CORS'}).`);
          const writable = await handle.createWritable();
          await response.body.pipeTo(writable);
          showToast(`تم تنزيل سورة ${surah.name} بصوت ${reciter.name_ar}.`);
          return;
        } catch (error) {
          if (error?.name === 'AbortError') return;
          console.info('Streaming save was unavailable; falling back to the reciter audio URL.', error);
        }
      }
      // Cross-origin download headers vary by audio host. Let the browser handle
      // the remote file natively instead of buffering it in JavaScript memory.
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      link.remove();
      showToast(`أُرسل طلب تحميل سورة ${surah.name} بصوت ${reciter.name_ar}. إذا فتح المتصفح مشغل الصوت بدل الحفظ، استخدم قائمة المشغل واختر تنزيل.`);
    } finally {
      button.disabled = false;
      button.classList.remove('loading');
    }
  }

  async function playAyah(ayahId) {
    hideReaderMessage();
    state.isFullSurahPlaying = false;
    const rows = state.chapterRows.length ? state.chapterRows : await ensureChapterTiming();
    const row = rows.find(item => item.ayahId === Number(ayahId));
    if (!row) {
      const reciter = getReciter();
      showReaderMessage(`توقيت الآية ${toArabicDigits(ayahId)} غير موجود في ملف هذا التسجيل (${reciter?.name_ar || ''}). جرّب قارئًا آخر أو استمع إلى السورة كاملة.`);
      setActiveVerse(ayahId, true);
      return;
    }
    try {
      await ensureAudioSource(state.activeSurah);
      state.clipEnd = row.end / 1000;
      setActiveVerse(ayahId, true);
      audio.currentTime = Math.max(0, row.start / 1000);
      await audio.play();
      updatePlayButton();
      updatePlayerLabels();
    } catch (error) {
      state.clipEnd = null;
      showReaderMessage(`تعذر تشغيل الآية: ${error.message} تحقق من اتصال الإنترنت أو جرّب قارئًا آخر.`);
      updatePlayButton();
    }
  }

  async function playRelativeAyah(direction) {
    const surah = getSurah(state.activeSurah);
    if (!surah) return;
    const rows = state.chapterRows.length ? state.chapterRows : await ensureChapterTiming();
    const currentIndex = surah.array.findIndex(verse => Number(verse.id) === state.activeAyah);
    const nextVerse = surah.array[currentIndex + direction];
    if (nextVerse) {
      const nextRow = rows.find(row => row.ayahId === Number(nextVerse.id));
      if (nextRow) return playAyah(nextVerse.id);
      // When a reciter lacks timing for one or more verses, move to the next timed verse.
      const candidate = direction > 0
        ? rows.find(row => row.ayahId > state.activeAyah)
        : [...rows].reverse().find(row => row.ayahId < state.activeAyah);
      if (candidate) return playAyah(candidate.ayahId);
      showToast('لا يتوفر توقيت للآية التالية مع هذا القارئ.');
      return;
    }
    if (direction > 0 && state.activeSurah < 114) {
      await openSurah(state.activeSurah + 1, 1, true);
      await playAyah(1);
    } else if (direction < 0 && state.activeSurah > 1) {
      const previousSurah = getSurah(state.activeSurah - 1);
      await openSurah(state.activeSurah - 1, previousSurah.array.length, true);
      await playAyah(previousSurah.array.length);
    }
  }

  function updatePlayerLabels() {
    const reciter = getReciter();
    const surah = getSurah(state.activeSurah);
    $('#player-reciter').textContent = reciter?.name_ar || 'اختر قارئًا';
    $('#player-surah').textContent = surah ? `سورة ${surah.name} · الآية ${toArabicDigits(state.activeAyah)}` : 'جاهز للاستماع';
    $('#player-avatar').textContent = reciterInitial(reciter);
    const albumSurahName = $('#album-surah-name');
    const albumReciterName = $('#album-reciter-name');
    if (albumSurahName) albumSurahName.textContent = surah ? `سورة ${surah.name}` : '—';
    if (albumReciterName) albumReciterName.textContent = reciter?.name_ar || '—';
    if ($('#record-disc')) $('#record-disc').classList.toggle('spinning', !audio.paused && !audio.ended);
    updatePlayerStudioSelection();
    updateDashboardProgress();
    const currentName = $('#reciter-current-name');
    const currentEn = $('#reciter-current-en');
    const currentAvatar = $('#reciter-current-avatar');
    if (currentName) currentName.textContent = reciter?.name_ar || 'اختر قارئًا';
    if (currentEn) currentEn.textContent = reciter?.name_en || 'Hafs an Asim';
    if (currentAvatar) {
      currentAvatar.textContent = reciterInitial(reciter);
      currentAvatar.style.setProperty('--hue', String(reciterHue(reciter)));
    }
    $$('#reciter-grid .reciter-chip').forEach(chip => {
      const active = chip.dataset.reciter === reciter?.id;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
      const check = $('.check', chip);
      if (active && !check) chip.insertAdjacentHTML('beforeend', '<svg class="check" aria-hidden="true"><use href="#i-check"/></svg>');
      if (!active && check) check.remove();
    });
  }

  function updatePlayButton() {
    const button = $('#player-toggle');
    const use = $('use', button);
    const playing = !audio.paused && !audio.ended;
    use.setAttribute('href', playing ? '#i-pause' : '#i-play');
    button.setAttribute('aria-label', playing ? 'إيقاف مؤقت' : 'تشغيل');
    const albumButton = $('#album-play-toggle');
    if (albumButton) {
      const albumUse = $('use', albumButton);
      if (albumUse) albumUse.setAttribute('href', playing ? '#i-pause' : '#i-play');
      albumButton.setAttribute('aria-label', playing ? 'إيقاف مؤقت' : 'تشغيل');
    }
    const studioLabel = $('#studio-ayah-label');
    if (studioLabel) studioLabel.textContent = `الآية ${dashboardNumber(state.activeAyah)} · ${playing ? 'تُتلى الآن' : 'جاهز للاستماع'}`;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '٠:٠٠';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${toArabicDigits(mins)}:${toArabicDigits(secs)}`;
  }

  function paintActiveWord(timeSeconds) {
    $$('.quran-word.word-active').forEach(word => word.classList.remove('word-active'));
    $$('.quran-word.ayah-word-active').forEach(word => word.classList.remove('ayah-word-active'));
    const timeMs = Math.max(0, Number(timeSeconds) || 0) * 1000;
    let activeRow = null;
    for (const row of state.chapterRows) {
      if (row.start <= timeMs) activeRow = row;
      else break;
    }
    if (!activeRow) return;
    const selector = `.quran-word[data-surah="${state.activeSurah}"][data-ayah="${activeRow.ayahId}"]`;
    const words = $$(selector);
    if (!words.length) return;
    const word = activeRow.words.find(item => item.start <= timeMs && timeMs <= item.end);
    const target = word ? words.find(item => Number(item.dataset.word) === Number(word.index)) : null;
    if (target && target.dataset.sync === 'word') {
      target.classList.add('word-active');
      state.activeWordKey = `${state.activeSurah}:${activeRow.ayahId}:${word.index}`;
    } else if (!activeRow.words.length) {
      // If the timing row has no word-level entries, mark the verse only as a transparent fallback.
      words.forEach(token => token.classList.add('ayah-word-active'));
      state.activeWordKey = `${state.activeSurah}:${activeRow.ayahId}`;
    } else {
      // Do not guess a word during silent gaps or when an index is absent.
      state.activeWordKey = null;
    }
  }

  function pageContainsWord(pageData, surahId, ayahId, oneBasedWordIndex) {
    const verse = pageData?.verses?.find(item => Number(item.surah_number) === Number(surahId) && Number(item.ayah_number) === Number(ayahId));
    return Boolean(verse?.words?.some(item => Number(item.word_index) === Number(oneBasedWordIndex) - 1));
  }

  async function syncPageToActiveWord(surahId, ayahId, wordIndex) {
    if (pageContainsWord(state.currentPageLayout, surahId, ayahId, wordIndex)) return;
    const key = `${surahId}:${ayahId}:${wordIndex}`;
    if (state.pageSyncPending === key) return;
    state.pageSyncPending = key;
    try {
      const loadedPages = Array.from(state.pageLayouts.entries()).sort((a, b) => a[0] - b[0]);
      for (const [pageNumber, promise] of loadedPages) {
        const pageData = await promise;
        if (pageContainsWord(pageData, surahId, ayahId, wordIndex)) {
          if (state.pageIndex !== pageNumber - 1) {
            state.pageIndex = pageNumber - 1;
            renderReader();
          }
          return;
        }
      }
      const versePage = pageIndexForVerse(surahId, ayahId) + 1;
      for (const pageNumber of [versePage + 1, versePage + 2]) {
        if (pageNumber > 604) continue;
        const pageData = await loadMushafPage(pageNumber);
        if (pageContainsWord(pageData, surahId, ayahId, wordIndex)) {
          if (state.pageIndex !== pageNumber - 1) {
            state.pageIndex = pageNumber - 1;
            renderReader();
          }
          return;
        }
      }
    } catch (error) {
      console.info('Unable to resolve page boundary for the active word.', error);
    } finally {
      if (state.pageSyncPending === key) state.pageSyncPending = null;
    }
  }

  function paintRangeFill(input) {
    if (!input) return;
    const min = Number(input.min || 0);
    const max = Number(input.max) || 1000;
    const ratio = Math.max(0, Math.min(1, (Number(input.value) - min) / (max - min || 1)));
    const percent = `${(ratio * 100).toFixed(1)}%`;
    const direction = getComputedStyle(input).direction === 'rtl' ? '270deg' : '90deg';
    input.style.background = `linear-gradient(${direction}, var(--accent) 0%, var(--accent) ${percent}, rgba(255, 255, 255, .14) ${percent}, rgba(255, 255, 255, .14) 100%)`;
  }

  function updateProgress() {
    const duration = audio.duration;
    const current = audio.currentTime || 0;
    $('#current-time').textContent = formatTime(current);
    $('#total-time').textContent = formatTime(duration);
    if (!state.isSeeking && Number.isFinite(duration) && duration > 0) {
      const progressValue = String(Math.round((current / duration) * 1000));
      $('#audio-progress').value = progressValue;
      const studioProgress = $('#studio-progress');
      if (studioProgress) studioProgress.value = progressValue;
    }
    const studioCurrent = $('#studio-current-time');
    const studioDuration = $('#studio-duration');
    const studioProgressControl = $('#studio-progress');
    if (studioCurrent) studioCurrent.textContent = formatTime(current);
    if (studioDuration) studioDuration.textContent = formatTime(duration);
    if (studioProgressControl) studioProgressControl.disabled = !(Number.isFinite(duration) && duration > 0);
    paintRangeFill($('#audio-progress'));
    paintRangeFill(studioProgressControl);
    if (state.clipEnd && current >= state.clipEnd - 0.035) {
      audio.pause();
      state.clipEnd = null;
      if (state.pageRepeat) { advancePageRepeat(); return; }
      // A clipped single-verse playback must not advance the active-verse
      // highlight into the next verse - not on this final tick, and not on any
      // stray timeupdate that fires after the pause. The guard is cleared when
      // playback resumes or the user seeks.
      state.clipJustEndedAyah = state.activeAyah;
      updatePlayButton();
      return;
    }
    if (state.chapterRows.length) {
      const timeMs = current * 1000;
      let active = null;
      for (const row of state.chapterRows) {
        if (row.start <= timeMs) active = row;
        else break;
      }
      if (active) {
        const holdClippedVerse = state.clipJustEndedAyah && audio.paused && active.ayahId !== state.clipJustEndedAyah;
        if (!holdClippedVerse) {
          markListenedVerse(state.activeSurah, active.ayahId);
          if (active.ayahId !== state.activeAyah) {
            setActiveVerse(active.ayahId, false);
            updatePlayerLabels();
          }
          const activeWord = active.words.find(item => item.start <= timeMs && timeMs <= item.end);
          if (activeWord && state.pageMapOfficial) {
            syncPageToActiveWord(state.activeSurah, active.ayahId, activeWord.index);
          } else {
            const versePage = pageIndexForVerse(state.activeSurah, active.ayahId);
            if (versePage !== state.pageIndex && !state.pageSyncPending) {
              state.pageIndex = versePage;
              renderReader();
            }
          }
          paintActiveWord(current);
        }
      }
    }
  }

  async function togglePlayback() {
    if (audio.paused || audio.ended) {
      if (!state.currentSource) return playSurah();
      try {
        await audio.play();
        updatePlayButton();
      } catch (error) {
        showReaderMessage(`تعذر استئناف الصوت: ${error.message}`);
      }
    } else {
      audio.pause();
      updatePlayButton();
    }
  }

  function toggleBookmark(ayahId) {
    const key = { s: state.activeSurah, a: Number(ayahId) };
    const exists = isBookmarked(key.s, key.a);
    state.bookmarks = exists
      ? state.bookmarks.filter(item => !(Number(item.s) === key.s && Number(item.a) === key.a))
      : [...state.bookmarks, key];
    writeStorage(STORAGE.bookmarks, state.bookmarks);
    updateBookmarkCount();
    const button = $(`[data-bookmark-verse="${key.a}"]`);
    if (button) {
      button.classList.toggle('saved', !exists);
      button.title = exists ? 'احفظ الآية' : 'إزالة من المحفوظات';
    }
    if (state.libraryMode === 'bookmarks') renderSurahList();
    showToast(exists ? 'أزيلت الآية من المحفوظات' : 'حُفظت الآية في المحفوظات');
  }

  async function shareVerse(ayahId) {
    const surah = getSurah(state.activeSurah);
    const verse = getVerse(state.activeSurah, ayahId);
    if (!surah || !verse) return;
    const text = `${verse.ar}\n\n[${surah.name} : ${toArabicDigits(ayahId)}]`;
    try {
      if (navigator.share) await navigator.share({ title: `سورة ${surah.name}`, text });
      else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast('نُسخت الآية إلى الحافظة');
      } else {
        showToast('ميزة المشاركة غير متاحة في هذا المتصفح.');
      }
    } catch (error) {
      if (error.name !== 'AbortError') showToast('تعذرت مشاركة الآية.');
    }
  }

  function setLibraryMode(mode) {
    state.libraryMode = mode;
    $$('.library-tab').forEach(tab => {
      const active = tab.dataset.library === mode;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    $('#surah-search').placeholder = mode === 'bookmarks' ? 'ابحث في المحفوظات...' : 'ابحث عن سورة أو آية...';
    renderSurahList();
  }

  function scrollToReader() {
    $('#reader')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const TAFSIR_SOURCES = ['التفسير الميسر', 'تفسير ابن كثير', 'تفسير السعدي', 'تفسير القرطبي', 'تفسير الطبري'];
  function dashboardNumber(value) { return toArabicDigits(value); }
  function renderDailyVerse() {
    if (!state.flatVerses.length) return;
    const day = Math.floor(Date.now() / 86400000);
    const entry = state.flatVerses[((day % state.flatVerses.length) + state.flatVerses.length) % state.flatVerses.length];
    state.dailyVerse = { s: Number(entry.surah.id), a: Number(entry.verse.id) };
    $('#daily-verse-text').textContent = entry.verse.ar;
    $('#daily-verse-reference').textContent = `سورة ${entry.surah.name} · الآية ${dashboardNumber(entry.verse.id)}`;
  }
  async function playDailyVerse() {
    const target = state.dailyVerse;
    if (!target) return;
    if (state.pageRepeat) stopPageRepeat();
    await openSurah(target.s, target.a, false);
    await playAyah(target.a);
  }
  async function openDailyVerseInReader() {
    const target = state.dailyVerse;
    if (!target) return;
    await openSurah(target.s, target.a, false);
    setNavState('reader');
    let attempts = 0;
    const reveal = () => {
      const units = $$(`.ayah-unit[data-surah="${target.s}"][data-ayah="${target.a}"]`);
      if (units.length) {
        units.forEach(unit => unit.classList.add('daily-target-highlight'));
        units[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => units.forEach(unit => unit.classList.remove('daily-target-highlight')), 3200);
      } else if (++attempts < 25) setTimeout(reveal, 120);
    };
    setTimeout(reveal, 160);
  }

  function markListenedVerse(surahId, ayahId) {
    if (audio.paused || !getVerse(surahId, ayahId)) return;
    const key = `${Number(surahId)}:${Number(ayahId)}`;
    if (state.lastCountedListenKey === key) return;
    state.lastCountedListenKey = key;
    if (!state.heardAyahs.has(key)) {
      state.heardAyahs.add(key);
      writeStorage(STORAGE.heardAyahs, [...state.heardAyahs]);
    }
    state.lastListened = { s: Number(surahId), a: Number(ayahId), reciter: getReciter()?.name_ar || '', at: Date.now() };
    writeStorage(STORAGE.lastListened, state.lastListened);
    updateDashboardProgress();
  }
  function markCompletedUntimedSurah() {
    const surah = getSurah(state.activeSurah);
    if (!surah || state.chapterRows.length) return;
    for (const verse of surah.array || []) state.heardAyahs.add(`${state.activeSurah}:${Number(verse.id)}`);
    writeStorage(STORAGE.heardAyahs, [...state.heardAyahs]);
    const lastVerse = surah.array?.[surah.array.length - 1];
    if (lastVerse) {
      state.lastListened = { s: state.activeSurah, a: Number(lastVerse.id), reciter: getReciter()?.name_ar || '', at: Date.now() };
      writeStorage(STORAGE.lastListened, state.lastListened);
    }
    updateDashboardProgress();
  }
  function updateDashboardProgress() {
    const confirmedPages = Object.keys(state.readPageRecords || {}).length;
    const percent = Math.min(100, Math.max(0, Math.round((confirmedPages / 604) * 100)));
    const latest = state.lastConfirmedRead;
    const lastReadSurah = latest ? getSurah(latest.s) : null;
    const lastReadAyah = Number(latest?.a || 1);
    $('#progress-percentage').textContent = `${dashboardNumber(percent)}٪`;
    $('#progress-position').textContent = `${dashboardNumber(confirmedPages)} صفحة مؤكدة من ٦٠٤`;
    $('#progress-ring-value').textContent = `${dashboardNumber(percent)}٪`;
    $('#progress-ring').style.setProperty('--progress', `${percent}%`);
    $('#progress-last-read').textContent = latest && lastReadSurah ? `${lastReadSurah.name} · ${dashboardNumber(lastReadAyah)}` : 'لم تؤكد قراءة صفحة بعد';
    const homeLastRead = $('#dashboard-last-read');
    if (homeLastRead) homeLastRead.textContent = latest && lastReadSurah ? `سورة ${lastReadSurah.name} · الآية ${dashboardNumber(lastReadAyah)}` : 'ابدأ رحلتك من سورة الفاتحة';
    $('#listened-count').textContent = dashboardNumber(state.heardAyahs.size);
    $('#bookmark-total').textContent = dashboardNumber(state.bookmarks.length);
    $('#progress-reciter').textContent = getReciter()?.name_ar || '—';
    const last = state.lastListened;
    const listenedSurah = last ? getSurah(last.s) : null;
    $('#last-listened-surah').textContent = listenedSurah ? `سورة ${listenedSurah.name}` : 'لم تبدأ الاستماع بعد';
    const lastVerse = last ? getVerse(last.s, last.a) : null;
    const versePreview = lastVerse?.ar ? `${lastVerse.ar.slice(0, 54)}${lastVerse.ar.length > 54 ? '…' : ''}` : '';
    $('#last-listened-ayah').textContent = last ? `الآية ${dashboardNumber(last.a)} · ${versePreview} · ${last.reciter || getReciter()?.name_ar || ''}` : 'ابدأ الاستماع لتظهر هنا';
    $('#offline-pages-count').textContent = readStorage('mishkat.mushaf-layout-cache.v2', null)?.complete ? '٦٠٤ / ٦٠٤' : `${dashboardNumber(readStorage('mishkat.mushaf-layout-cache.v2', null)?.pages || 0)} / ٦٠٤`;
    const activeSurah = getSurah(state.activeSurah);
    if (activeSurah) {
      const albumSurahName = $('#album-surah-name');
      const albumReciterName = $('#album-reciter-name');
      if (albumSurahName) albumSurahName.textContent = `سورة ${activeSurah.name}`;
      if (albumReciterName) albumReciterName.textContent = getReciter()?.name_ar || '—';
    }
    updatePlayerStudioSelection();
  }
  function renderSurahInformation(surahId = state.activeSurah) {
    const surah = getSurah(surahId);
    if (!surah) return;
    $('#dashboard-surah-select').value = String(surah.id);
    $('#surah-info-name').textContent = surah.name;
    $('#surah-info-subtitle').textContent = `السورة رقم ${dashboardNumber(surah.id)} في ترتيب المصحف`;
    const type = String(surah.type || '').includes('مدنية') || String(surah.type_en || '').toLowerCase().includes('medina') ? 'مدنية' : 'مكية';
    const page = pageIndexForVerse(Number(surah.id), 1) + 1;
    const items = [
      ['نوع السورة', type], ['عدد الآيات', dashboardNumber(surah.array?.length || 0)],
      ['عدد الكلمات', dashboardNumber(surah.words || 0)], ['عدد الحروف', dashboardNumber(surah.letters || 0)],
      ['ترتيب المصحف', dashboardNumber(surah.id)], ['صفحة البداية', dashboardNumber(page)]
    ];
    $('#surah-info-grid').innerHTML = items.map(([label, value]) => `<div class="surah-info-cell"><span>${escapeHTML(label)}</span><strong>${escapeHTML(value)}</strong></div>`).join('');
  }
  function renderStudioLists() {
    renderStudioReciterList($('#studio-reciter-search')?.value || '');
    renderStudioSurahList($('#studio-surah-search')?.value || '');
  }
  function renderStudioReciterList(query = '') {
    const host = $('#studio-reciter-list');
    if (!host) return;
    const q = normalizeArabic(query);
    const items = state.reciters.filter(reciter => !q || normalizeArabic(`${reciter.name_ar} ${reciter.name_en || ''}`).includes(q));
    $('#studio-reciter-count').textContent = `${dashboardNumber(items.length)} قارئ`;
    host.innerHTML = items.map(reciter => `<button class="studio-list-item studio-reciter-item ${reciter.id === state.reciterId ? 'active' : ''}" data-studio-reciter="${escapeHTML(reciter.id)}" aria-pressed="${reciter.id === state.reciterId}"><span class="studio-item-avatar">${escapeHTML(reciterInitial(reciter))}</span><span class="studio-item-copy"><strong>${escapeHTML(reciter.name_ar)}</strong><small>${reciter.timing?.word_file ? 'تزامن الكلمات متاح' : 'تلاوة كاملة'}</small></span>${reciter.id === state.reciterId ? '<span class="studio-item-check">✓</span>' : ''}</button>`).join('') || '<p class="dashboard-note">لا يوجد قارئ بهذا الاسم.</p>';
  }
  function renderStudioSurahList(query = '') {
    const host = $('#studio-surah-list');
    if (!host) return;
    const q = normalizeArabic(query);
    const items = state.quran.filter(surah => !q || normalizeArabic(`${surah.name} ${surah.name_en || ''} ${surah.name_translation || ''} ${surah.id}`).includes(q));
    host.innerHTML = items.map(surah => `<button class="studio-list-item studio-surah-item ${Number(surah.id) === state.activeSurah ? 'active' : ''}" data-studio-surah="${surah.id}" aria-pressed="${Number(surah.id) === state.activeSurah}"><span class="studio-surah-number">${dashboardNumber(surah.id)}</span><span class="studio-item-copy"><strong>${escapeHTML(surah.name)}</strong><small>${escapeHTML(String(surah.type || ''))} · ${dashboardNumber(surah.array?.length || 0)} آية</small></span>${Number(surah.id) === state.activeSurah ? '<span class="studio-item-check">✓</span>' : ''}</button>`).join('') || '<p class="dashboard-note">لا توجد سورة بهذا الاسم.</p>';
  }
  function updatePlayerStudioSelection() {
    const reciter = getReciter();
    const surah = getSurah(state.activeSurah);
    $$('[data-studio-reciter]').forEach(item => {
      const active = item.dataset.studioReciter === reciter?.id;
      item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active));
    });
    $$('[data-studio-surah]').forEach(item => {
      const active = Number(item.dataset.studioSurah) === state.activeSurah;
      item.classList.toggle('active', active); item.setAttribute('aria-pressed', String(active));
    });
    const ayah = $('#studio-ayah-label');
    if (ayah) ayah.textContent = `الآية ${dashboardNumber(state.activeAyah)} · ${audio.paused ? 'جاهز للاستماع' : 'تُتلى الآن'}`;
    const name = $('#album-surah-name'); if (name && surah) name.textContent = `سورة ${surah.name}`;
    const artist = $('#album-reciter-name'); if (artist) artist.textContent = reciter?.name_ar || '—';
  }
  async function selectStudioSurah(surahId) {
    const id = Number(surahId);
    if (!getSurah(id)) return;
    await openSurah(id, 1, false);
    await ensureChapterTiming();
    updatePlayerLabels();
    showToast(`تم اختيار سورة ${getSurah(id).name}. اضغط تشغيل لبدء التلاوة.`);
  }
  function selectStudioReciter(reciterId) {
    const select = $('#reciter-select');
    if (!select || !state.reciters.some(reciter => reciter.id === reciterId)) return;
    if (select.value !== reciterId) { select.value = reciterId; select.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  function initializeDashboardControls() {
    const options = state.quran.map(surah => `<option value="${surah.id}">${dashboardNumber(surah.id)} · ${escapeHTML(surah.name)}</option>`).join('');
    $('#dashboard-surah-select').innerHTML = options;
    $('#tafsir-surah-select').innerHTML = options;
    $('#dashboard-date').textContent = new Intl.DateTimeFormat('ar-EG', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
    renderStudioLists();
    renderDailyVerse();
    renderSurahInformation(state.activeSurah);
    updateDashboardProgress();
    updatePlayerModeButtons();
  }
  function updatePlayerModeButtons() {
    const repeat = $('#album-repeat');
    const autoNext = $('#album-auto-next');
    if (repeat) { repeat.classList.toggle('active', state.playerRepeat); repeat.setAttribute('aria-pressed', String(state.playerRepeat)); }
    if (autoNext) { autoNext.classList.toggle('active', state.playerAutoNext); autoNext.setAttribute('aria-pressed', String(state.playerAutoNext)); }
  }
  function showWelcome() {
    if (document.body.classList.contains('player-standalone')) { location.href = 'index.html'; return; }
    showDashboardView('progress');
    document.body.classList.remove('reader-mode');
    $$('.nav-link[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === 'home'));
    $('#home-dashboard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function showDashboardView(name, target = null) {
    if (name === 'player' && !document.body.classList.contains('player-standalone')) {
      const surah = Number(target?.s || state.activeSurah || 1);
      const ayah = Number(target?.a || state.activeAyah || 1);
      writeStorage('mishkat.playerLaunchTarget.v1', { s: surah, a: ayah, at: Date.now() });
      location.href = 'player.html';
      return;
    }
    const titles = { progress: 'تقدّمي', surah: 'بيانات السور', player: 'مشغل السور', tafsir: 'التفسير', hadith: 'الأحاديث' };
    document.body.classList.remove('welcome-mode', 'feature-mode');
    $$('.dashboard-tab').forEach(button => {
      const active = button.dataset.dashboardView === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    $$('.dashboard-view').forEach(panel => {
      const active = panel.dataset.viewPanel === name;
      panel.classList.toggle('active', active);
      panel.hidden = !active;
    });
    const title = $('#dashboard-view-title');
    if (title) title.textContent = titles[name] || 'تقدّمي';
    if (name === 'progress') updateDashboardProgress();
    if (name === 'surah') renderSurahInformation(Number($('#dashboard-surah-select').value || state.activeSurah));
    if (name === 'player') { renderStudioLists(); updatePlayerLabels(); updateDashboardProgress(); }
    if (name === 'tafsir') {
      syncTafsirSelection();
      loadTafsirForSurah(Number(target?.s || $('#tafsir-surah-select').value || state.activeSurah)).then(() => {
        if (target?.a) { $('#tafsir-ayah-number').value = String(target.a); renderSelectedTafsir(); }
      });
    }
    if (name === 'hadith') loadHadithCollection().catch(error => { $('#hadith-list').innerHTML = `<p class="dashboard-note">${escapeHTML(error.message)} يمكن تنزيل المجموعة محلياً عبر أدوات المشروع.</p>`; });
    if (!document.body.classList.contains('player-standalone')) {
      $$('.nav-link[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === 'home'));
    }
    if (document.body.classList.contains('player-standalone')) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function loadTafsirForSurah(surahId) {
    const sid = Number(surahId);
    if (!getSurah(sid)) return;
    try {
      let data = state.tafsirCache.get(sid);
      if (!data) {
        let pending = state.tafsirPending.get(sid);
        if (!pending) {
          pending = (async () => {
            const response = await fetch(`data/tafsir/${String(sid).padStart(3, '0')}.json`, { cache: 'default' });
            if (!response.ok) throw new Error(`تعذر تحميل تفسير السورة (${response.status})`);
            const parsed = await response.json();
            if (Number(parsed.number) !== sid || !Array.isArray(parsed.ayahs)) throw new Error('ملف التفسير لا يطابق السورة المطلوبة.');
            return parsed;
          })();
          state.tafsirPending.set(sid, pending);
        }
        try { data = await pending; }
        finally { state.tafsirPending.delete(sid); }
        state.tafsirCache.set(sid, data);
        while (state.tafsirCache.size > 2) state.tafsirCache.delete(state.tafsirCache.keys().next().value);
      }
      if (Number($('#tafsir-surah-select').value) !== sid) return;
      const ayahInput = $('#tafsir-ayah-number');
      const keepAyah = Number(ayahInput.value || state.activeAyah);
      ayahInput.max = String(getSurah(sid).array.length);
      ayahInput.value = String(getVerse(sid, keepAyah) ? keepAyah : 1);
      renderSelectedTafsir();
    } catch (error) {
      $('#tafsir-text').textContent = `${error.message} تحقق من وجود ملفات التفسير محلياً.`;
    }
  }
  function syncTafsirSelection() {
    const sid = Number(state.activeSurah || 1);
    if (getSurah(sid)) $('#tafsir-surah-select').value = String(sid);
  }
  function renderSelectedTafsir() {
    const sid = Number($('#tafsir-surah-select').value || state.activeSurah);
    const aid = Number($('#tafsir-ayah-number').value || 1);
    const source = $('#tafsir-source-select').value || TAFSIR_SOURCES[0];
    const verse = getVerse(sid, aid);
    $('#tafsir-verse-text').textContent = verse?.ar || '';
    $('#tafsir-source-label').textContent = source;
    const surahTafsir = state.tafsirCache.get(sid);
    const entry = surahTafsir?.ayahs?.find(item => Number(item.ayah_number) === aid);
    const tafsir = entry?.tafsir?.find(item => item.type === source)?.text || '';
    $('#tafsir-text').textContent = tafsir.trim() || 'لا يتوفر نص مستقل لهذا الموضع في ملف المصدر؛ قد يكون الشرح متصلاً بالآية السابقة.';
  }
  const HADITH_COLLECTIONS = {
    nawawi: { name: 'الأربعون النووية', edition: 'ara-nawawi', file: 'ara-nawawi.min.json', min: 42 },
    bukhari: { name: 'صحيح البخاري', edition: 'ara-bukhari', file: 'ara-bukhari.min.json', min: 1000 },
    muslim: { name: 'صحيح مسلم', edition: 'ara-muslim', file: 'ara-muslim.min.json', min: 1000 },
    abudawud: { name: 'سنن أبي داود', edition: 'ara-abudawud', file: 'ara-abudawud.min.json', min: 1000 },
    tirmidhi: { name: 'جامع الترمذي', edition: 'ara-tirmidhi', file: 'ara-tirmidhi.min.json', min: 1000 },
    nasai: { name: 'سنن النسائي', edition: 'ara-nasai', file: 'ara-nasai.min.json', min: 1000 },
    ibnmajah: { name: 'سنن ابن ماجه', edition: 'ara-ibnmajah', file: 'ara-ibnmajah.min.json', min: 1000 }
  };
  function validateHadithEdition(data, config) {
    if (!data || !Array.isArray(data.hadiths)) throw new Error('صيغة مجموعة الأحاديث غير صحيحة.');
    const entries = data.hadiths.filter(item => item && typeof item.text === 'string' && item.text.trim());
    if (entries.length < config.min) throw new Error(`مجموعة ${config.name} ناقصة: ${entries.length} حديثاً فقط.`);
    return entries;
  }
  async function loadHadithCollection(collectionId = $('#hadith-collection')?.value || state.hadithCollectionId) {
    const config = HADITH_COLLECTIONS[collectionId] || HADITH_COLLECTIONS.nawawi;
    state.hadithCollectionId = collectionId;
    state.hadithCollectionName = config.name;
    if (state.hadithCollectionCache.has(collectionId)) {
      state.hadiths = state.hadithCollectionCache.get(collectionId);
      state.selectedHadith = Math.min(state.selectedHadith, Math.max(0, state.hadiths.length - 1));
      $('#hadith-heading-title').textContent = config.name;
      return renderHadithList();
    }
    $('#hadith-list').innerHTML = '<p class="dashboard-note">يتم تحميل نصوص المجموعة…</p>';
    $('#hadith-text').textContent = 'جارٍ تجهيز نصوص الكتاب المختار.';
    const localPath = `data/hadith/${config.file}`;
    const remoteUrls = [
      `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${config.edition}.min.json`,
      `https://cdn.jsdelivr.net/gh/fawazahmed0/hadith-api@1/editions/${config.edition}.json`,
      `https://raw.githubusercontent.com/fawazahmed0/hadith-api/1/editions/${config.edition}.min.json`
    ];
    let data = null;
    try {
      const localResponse = await fetch(localPath, { cache: 'default' });
      if (localResponse.ok) {
        const candidate = await localResponse.json();
        try { validateHadithEdition(candidate, config); data = candidate; } catch (_) { /* placeholder or missing local edition: use cached/download route */ }
      }
    } catch (_) { /* absent local data: try previously cached or remote edition */ }
    if (!data) {
      let cache = null;
      try { if ('caches' in window) cache = await caches.open('mishkat-hadith-local-v2'); } catch (_) {}
      let lastError = null;
      for (const url of remoteUrls) {
        try {
          let response = cache ? await cache.match(url) : null;
          if (!response) response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
          if (!response.ok) throw new Error(`تعذر تحميل ${config.name} (${response.status}).`);
          const candidate = await response.clone().json();
          validateHadithEdition(candidate, config);
          data = candidate;
          try { if (cache) await cache.put(url, response.clone()); } catch (_) {}
          break;
        } catch (error) { lastError = error; }
      }
      if (!data) throw lastError || new Error(`تعذر الوصول إلى نصوص ${config.name}.`);
    }
    state.hadiths = validateHadithEdition(data, config).map((item, index) => ({
      number: Number(item.hadithnumber || item.arabicnumber || index + 1),
      text: String(item.text || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').trim(),
      reference: `${config.name} · رقم ${item.reference?.hadith || item.hadithnumber || item.arabicnumber || index + 1}`
    }));
    state.hadithCollectionCache.clear();
    state.hadithCollectionCache.set(collectionId, state.hadiths);
    state.selectedHadith = 0;
    renderHadithList();
  }
  function renderHadithList(query = $('#hadith-search')?.value || '') {
    const q = normalizeArabic(query);
    const matches = state.hadiths.map((hadith, index) => ({ ...hadith, index })).filter(h => !q || normalizeArabic(h.text).includes(q) || String(h.number).includes(q));
    $('#hadith-list').innerHTML = matches.map(h => `<button class="hadith-item ${h.index === state.selectedHadith ? 'active' : ''}" data-hadith-index="${h.index}">الحديث ${dashboardNumber(h.number)}</button>`).join('') || '<p class="dashboard-note">لا توجد نتائج مطابقة.</p>';
    const selected = state.hadiths[state.selectedHadith];
    $('#hadith-heading-title').textContent = state.hadithCollectionName || 'مكتبة الأحاديث';
    if (selected) {
      $('#hadith-title').textContent = `الحديث ${dashboardNumber(selected.number)}`;
      $('#hadith-text').textContent = selected.text;
      $('#hadith-reference').textContent = selected.reference;
    }
  }
  async function openTafsirAt(surahId, ayahId) {
    showDashboardView('tafsir', { s: Number(surahId), a: Number(ayahId) });
  }

  function openSurahInPlayer() {
    showDashboardView('player', { s: state.activeSurah, a: state.activeAyah });
  }
  async function changePlayerSurah(direction) {
    const next = Math.min(114, Math.max(1, state.activeSurah + direction));
    if (next === state.activeSurah) { showToast(direction > 0 ? 'أنت عند آخر سورة في المصحف.' : 'أنت عند أول سورة في المصحف.'); return; }
    await openSurah(next, 1, false);
    await playSurah();
    updateDashboardProgress();
  }
  function showAyahSelectionMenu(selection) {
    if (matchMedia('(hover: none) and (pointer: coarse)').matches) return;
    const menu = $('#ayah-selection-menu');
    if (!selection || selection.isCollapsed || !$('#quran-content').contains(selection.anchorNode) || !$('#quran-content').contains(selection.focusNode)) { menu.hidden = true; return; }
    let range;
    try { range = selection.getRangeAt(0); } catch (_) { menu.hidden = true; return; }
    const selectedUnits = $$('.ayah-unit').filter(unit => {
      try { return range.intersectsNode(unit); } catch (_) { return false; }
    });
    if (!selectedUnits.length) { menu.hidden = true; return; }
    const first = selectedUnits[0];
    const sid = first.dataset.surah, aid = first.dataset.ayah;
    const sameVerse = selectedUnits.every(unit => unit.dataset.surah === sid && unit.dataset.ayah === aid);
    if (!sameVerse) { menu.hidden = true; return; }
    const rect = range.getBoundingClientRect();
    menu.hidden = false;
    const width = menu.offsetWidth || 260;
    menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2))}px`;
    menu.style.top = `${Math.max(8, rect.top - 52)}px`;
    menu.dataset.surah = sid;
    menu.dataset.ayah = aid;
  }
  function setNavState(name) {
    const standalone = document.body.classList.contains('player-standalone');
    if (name === 'home') { showWelcome(); return; }
    if (name === 'reader') {
      if (standalone) { location.href = 'index.html#reader'; return; }
      document.body.classList.remove('welcome-mode', 'feature-mode');
      $$('.nav-link[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === 'reader'));
      setLibraryMode('surahs'); setLibraryOpen(false); scrollToReader();
    } else if (name === 'listen') {
      if (standalone) showDashboardView('player');
      else showDashboardView('player');
    } else if (name === 'saved') {
      if (standalone) { location.href = 'index.html#reader'; return; }
      document.body.classList.remove('welcome-mode', 'feature-mode');
      $$('.nav-link[data-nav]').forEach(link => link.classList.toggle('active', link.dataset.nav === 'saved'));
      setLibraryMode('bookmarks'); scrollToReader();
      if (window.matchMedia('(max-width: 860px)').matches) setLibraryOpen(true);
    }
  }
  function openProgressShareDialog() {
    $('#progress-share-dialog').hidden = false;
    document.body.classList.add('dialog-open');
    $('#progress-share-name').value = '';
    setTimeout(() => $('#progress-share-name').focus(), 30);
  }
  function closeProgressShareDialog() {
    $('#progress-share-dialog').hidden = true;
    document.body.classList.remove('dialog-open');
  }
  async function generateProgressShareImage() {
    const name = $('#progress-share-name').value.trim();
    if (!name) { $('#progress-share-name').focus(); showToast('اكتب الاسم الذي سيظهر على البطاقة أولاً.'); return; }
    const pages = Object.keys(state.readPageRecords || {}).length;
    const percent = Math.round((pages / 604) * 100);
    const latest = state.lastConfirmedRead;
    const lastSurah = latest ? getSurah(latest.s)?.name : 'لم تبدأ بعد';
    try {
      if (document.fonts?.ready) await document.fonts.ready;
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1500;
      const ctx = canvas.getContext('2d');
      const bg = ctx.createLinearGradient(0,0,1200,1500); bg.addColorStop(0,'#101718'); bg.addColorStop(.55,'#080b0c'); bg.addColorStop(1,'#14201e');
      ctx.fillStyle = bg; ctx.fillRect(0,0,1200,1500);
      ctx.strokeStyle = 'rgba(229,203,146,.12)'; ctx.lineWidth = 2;
      for(let i=0;i<9;i++){ctx.beginPath();ctx.arc(600,620,130+i*52,0,Math.PI*2);ctx.stroke();}
      ctx.strokeStyle='rgba(229,203,146,.32)'; ctx.lineWidth=2; ctx.strokeRect(54,54,1092,1392);
      ctx.direction='rtl'; ctx.textAlign='right';
      ctx.fillStyle='#e5cb92'; ctx.font='30px "Readex Pro", sans-serif'; ctx.fillText('رِحْلَتِي مَعَ الْقُرْآن',1060,160);
      ctx.fillStyle='#f2ecdf'; ctx.font='74px "Amiri", serif'; ctx.fillText('مشكاة',1060,285);
      ctx.fillStyle='rgba(242,236,223,.72)'; ctx.font='34px "Readex Pro", sans-serif'; ctx.fillText(`هذه رحلة ${name} مع كتاب الله`,1060,365);
      ctx.textAlign='center'; ctx.fillStyle='#e5cb92'; ctx.font='116px "Readex Pro", sans-serif'; ctx.fillText(`${toArabicDigits(percent)}٪`,600,690);
      ctx.fillStyle='rgba(242,236,223,.76)'; ctx.font='32px "Readex Pro", sans-serif'; ctx.fillText('من صفحات المصحف التي أكدت قراءتها',600,755);
      const x=170, y=850, w=860, h=18; ctx.fillStyle='rgba(255,255,255,.13)'; ctx.fillRect(x,y,w,h); ctx.fillStyle='#d9bd7b'; ctx.fillRect(x,y,w*(percent/100),h);
      ctx.direction='rtl'; ctx.textAlign='right'; ctx.fillStyle='#f2ecdf'; ctx.font='34px "Readex Pro", sans-serif'; ctx.fillText(`الصفحات المقروءة: ${toArabicDigits(pages)} من ٦٠٤`,1060,980);
      ctx.fillStyle='rgba(242,236,223,.78)'; ctx.font='29px "Readex Pro", sans-serif'; ctx.fillText(`آخر موضع مؤكد: ${lastSurah}${latest ? ` · الآية ${dashboardNumber(latest.a)}` : ''}`,1060,1050);
      ctx.fillText(`آيات استمعت إليها: ${dashboardNumber(state.heardAyahs.size)}`,1060,1120);
      ctx.fillText(`العلامات المرجعية: ${dashboardNumber(state.bookmarks.length)}`,1060,1190);
      ctx.textAlign='center'; ctx.fillStyle='rgba(229,203,146,.5)'; ctx.font='26px "Amiri", serif'; ctx.fillText('اللَّهُمَّ اجْعَلِ الْقُرْآنَ نُورَ قُلُوبِنَا',600,1325);
      ctx.textAlign='right'; ctx.direction='rtl'; ctx.fillStyle='rgba(242,236,223,.38)'; ctx.font='18px "Readex Pro", sans-serif'; ctx.fillText('مشكاة  ·  quran-meshkat.ykdev321.workers.dev',1090,1400);
      const blob = await new Promise(resolve => canvas.toBlob(resolve,'image/png'));
      if (!blob) throw new Error('لم يتمكن المتصفح من إنشاء الصورة.');
      const url=URL.createObjectURL(blob), link=document.createElement('a'); link.href=url; link.download='mishkat-reading-progress.png'; document.body.appendChild(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),1500);
      closeProgressShareDialog(); showToast('تم إنشاء بطاقة تقدّمك وحفظها كصورة PNG.');
    } catch(error) { showToast(`تعذر إنشاء الصورة: ${error.message}`); }
  }

  function openSearch() {
    $('#search-overlay').hidden = false;
    document.body.classList.add('dialog-open');
    $('#global-search').value = '';
    $('#search-results').innerHTML = '<div class="search-empty">ابدأ بكتابة كلمة للبحث في آيات القرآن الكريم.</div>';
    setTimeout(() => $('#global-search').focus(), 40);
  }
  function closeSearch() {
    $('#search-overlay').hidden = true;
    document.body.classList.toggle('dialog-open', !$('#reciter-dialog').hidden || !$('#page-index-dialog').hidden);
    $('#search-open').focus();
  }

  function runSearch(query) {
    const normalized = normalizeArabic(query);
    const results = $('#search-results');
    if (normalized.length < 2) {
      results.innerHTML = '<div class="search-empty">اكتب حرفين على الأقل لبدء البحث.</div>';
      return;
    }
    const matches = [];
    for (const surah of state.quran) {
      const surahMatch = normalizeArabic(`${surah.name} ${surah.name_en} ${surah.name_translation}`).includes(normalized);
      for (const verse of surah.array) {
        const arabicMatch = normalizeArabic(verse.ar).includes(normalized);
        const englishMatch = normalizeArabic(verse.en || '').includes(normalized);
        if (arabicMatch || englishMatch || (surahMatch && verse.id === 1)) {
          matches.push({ surah, verse, reason: arabicMatch ? 'مطابقة في النص العربي' : englishMatch ? 'مطابقة في الترجمة' : 'اسم السورة' });
          if (matches.length >= 90) break;
        }
      }
      if (matches.length >= 90) break;
    }
    if (!matches.length) {
      results.innerHTML = '<div class="search-empty">لم نعثر على نتائج مطابقة. جرّب كلمة أخرى.</div>';
      return;
    }
    results.innerHTML = matches.map(({ surah, verse, reason }) => `
      <button class="search-result" data-go-verse="${surah.id}:${verse.id}">
        <div class="search-result-head"><strong>سورة ${escapeHTML(surah.name)} · الآية ${toArabicDigits(verse.id)}</strong><span>${reason}</span></div>
        <p lang="ar" dir="rtl">${escapeHTML(verse.ar)}</p>
        <small>${escapeHTML((verse.en || '').slice(0, 155))}</small>
      </button>`).join('');
  }

  function applyTheme(theme) {
    const light = theme === 'light';
    document.body.classList.toggle('light-theme', light);
    $('use', $('#theme-toggle')).setAttribute('href', light ? '#i-sun' : '#i-moon');
    $('#theme-toggle').title = light ? 'المظهر الفاتح' : 'المظهر الداكن';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', light ? '#f4f1e9' : '#08090a');
    writeStorage(STORAGE.theme, light ? 'light' : 'dark');
  }

  function applyFontSize(size, notify = true) {
    const requested = Number(size);
    const safeSize = Number.isFinite(requested) ? requested : DEFAULT_QURAN_FONT_SIZE;
    const next = Math.min(4.2, Math.max(1.4, safeSize));
    state.fontSize = Number(next.toFixed(2));
    const zoom = Number((state.fontSize / DEFAULT_QURAN_FONT_SIZE).toFixed(3));
    document.documentElement.style.setProperty('--quran-zoom', String(zoom));
    writeStorage(STORAGE.font, state.fontSize);
    if (notify) showToast(`حجم خط المصحف: ${toArabicDigits(Math.round(zoom * 100))}٪`);
  }

  function registerServiceWorker() {
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('service-worker.js').catch(error => console.info('Service worker not registered:', error));
    }
  }

  // Events: library and verse controls.
  $('#surah-list').addEventListener('click', async event => {
    const surahButton = event.target.closest('[data-open-surah]');
    if (surahButton) {
      if (state.pageRepeat) stopPageRepeat();
      await openSurah(Number(surahButton.dataset.openSurah), 1, true);
      setLibraryOpen(false);
      setNavState('reader');
      return;
    }
    const verseButton = event.target.closest('[data-open-verse]');
    if (verseButton) {
      if (state.pageRepeat) stopPageRepeat();
      const [surahId, ayahId] = verseButton.dataset.openVerse.split(':').map(Number);
      await openSurah(surahId, ayahId, true);
      setLibraryOpen(false);
      setNavState('reader');
    }
  });
  $('#surah-search').addEventListener('input', () => renderSurahList());
  $$('.library-tab').forEach(tab => tab.addEventListener('click', () => { if (tab.dataset.library === 'verse-search') { openSearch(); return; } setLibraryMode(tab.dataset.library); }));

  $('#quran-content').addEventListener('click', async event => {
    const word = event.target.closest('.quran-word');
    const unit = event.target.closest('.ayah-unit');
    if (!unit) return;
    const surahId = Number(unit.dataset.surah), ayahId = Number(unit.dataset.ayah);
    if (surahId !== state.activeSurah) await openSurah(surahId, ayahId, false);
    setActiveVerse(ayahId, false);
    if (word) {
      state.isFullSurahPlaying = false;
      if (!state.timings.has(state.reciterId)) await ensureChapterTiming();
      const row = getTimingRow(surahId, ayahId);
      const wordIndex = Number(word.dataset.word);
      const part = row?.words?.find(item => item.index === wordIndex);
      if (part && word.dataset.sync === 'word') {
        try {
          await ensureAudioSource(surahId);
          state.clipEnd = null;
          audio.currentTime = part.start / 1000;
          await audio.play();
        } catch (error) { showToast('لم أستطع الانتقال إلى هذه الكلمة؛ تحقق من اتصال الصوت.'); }
      } else {
        showToast('لا يتوفر توقيت كلمة موثوق لهذا الموضع مع القارئ الحالي.');
      }
    }
  });

  $('#play-surah').addEventListener('click', playSurah);
  $('#previous-page').addEventListener('click', () => goToPage(state.pageIndex));
  $('#next-page').addEventListener('click', () => goToPage(state.pageIndex + 2));
  $('#repeat-page').addEventListener('click', togglePageRepeat);
  $('#download-surah-audio').addEventListener('click', downloadCurrentSurahAudio);
  $('#page-number-input').addEventListener('change', event => { const n = Number(event.target.value); if (Number.isFinite(n)) goToPage(n); });
  $('#page-number-input').addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); $('#page-number-input').blur(); } });
  $('#player-toggle').addEventListener('click', togglePlayback);
  $('#previous-ayah').addEventListener('click', () => playRelativeAyah(-1));
  $('#next-ayah').addEventListener('click', () => playRelativeAyah(1));
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('durationchange', updateProgress);
  audio.addEventListener('play', () => { state.clipJustEndedAyah = null; updatePlayButton(); updatePlayerLabels(); markListenedVerse(state.activeSurah,state.activeAyah); });
  audio.addEventListener('pause', () => { updatePlayButton(); updatePlayerLabels(); });
  audio.addEventListener('ended', async () => {
    state.clipEnd = null;
    if (state.pageRepeat) { advancePageRepeat(); return; }
    if (state.isFullSurahPlaying) {
      markCompletedUntimedSurah();
      state.isFullSurahPlaying = false;
      if (state.playerRepeat) { await playSurah(); return; }
      if (state.playerAutoNext && state.activeSurah < 114) { await openSurah(state.activeSurah + 1, 1, false); await playSurah(); return; }
    }
    updatePlayButton(); updateProgress();
  });
  audio.addEventListener('error', () => {
    state.isFullSurahPlaying = false;
    if (state.currentSource) showReaderMessage('لم يتمكن المتصفح من تشغيل رابط الصوت الحالي. قد يكون الخادم الخارجي متوقفًا مؤقتًا أو يتطلب اتصالًا مختلفًا؛ جرّب قارئًا آخر.');
    updatePlayButton();
  });
  $('#audio-progress').addEventListener('input', () => {
    state.isSeeking = true;
    $('#current-time').textContent = formatTime((Number($('#audio-progress').value) / 1000) * (audio.duration || 0));
    paintRangeFill($('#audio-progress'));
  });
  $('#audio-progress').addEventListener('change', () => {
    if (Number.isFinite(audio.duration) && audio.duration > 0) audio.currentTime = (Number($('#audio-progress').value) / 1000) * audio.duration;
    state.clipJustEndedAyah = null;
    state.isSeeking = false;
  });
  $('#playback-speed').addEventListener('change', event => { audio.playbackRate = Number(event.target.value) || 1; });

  $('#reciter-select').addEventListener('change', async event => {
    const currentAyah = state.activeAyah;
    state.isFullSurahPlaying = false;
    state.reciterId = event.target.value;
    if (state.pageRepeat) stopPageRepeat();
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    state.currentSource = null;
    state.clipEnd = null;
    state.chapterRows = [];
    updatePlayerLabels();
    updatePlayButton();
    showToast(`تم اختيار ${getReciter()?.name_ar || 'القارئ'}`);
    // Load only the chosen reciter's timing data when needed, without downloading audio.
    await ensureChapterTiming();
    setActiveVerse(currentAyah, false);
    renderReader();
    updateDashboardProgress();
  });

  $('#translation-toggle').addEventListener('click', () => {
    state.translationVisible = !state.translationVisible;
    $('#quran-content').classList.toggle('show-translation', state.translationVisible);
    $('#translation-toggle').setAttribute('aria-pressed', String(state.translationVisible));
  });
  $('#font-larger').addEventListener('click', () => applyFontSize(state.fontSize + .15));
  $('#font-reset').addEventListener('click', () => applyFontSize(DEFAULT_QURAN_FONT_SIZE));
  $('#font-smaller').addEventListener('click', () => applyFontSize(state.fontSize - .15));
  $('#theme-toggle').addEventListener('click', () => applyTheme(document.body.classList.contains('light-theme') ? 'dark' : 'light'));
  $('#search-open').addEventListener('click', openSearch);
  $('#search-close').addEventListener('click', closeSearch);
  $('[data-close-search]').addEventListener('click', closeSearch);
  $('#global-search').addEventListener('input', event => runSearch(event.target.value));
  $('#search-results').addEventListener('click', async event => {
    const result = event.target.closest('[data-go-verse]');
    if (!result) return;
    const [surahId, ayahId] = result.dataset.goVerse.split(':').map(Number);
    closeSearch();
    if (state.pageRepeat) stopPageRepeat();
    await openSurah(surahId, ayahId, true);
    setNavState('reader');
  });

  $$('.nav-link[data-nav]').forEach(link => link.addEventListener('click', () => setNavState(link.dataset.nav)));

  // Library drawer.
  $('#mobile-menu').addEventListener('click', () => setLibraryOpen(!document.body.classList.contains('library-open')));
  $('#library-close').addEventListener('click', () => setLibraryOpen(false));
  $('#library-scrim').addEventListener('click', () => setLibraryOpen(false));

  // Reciter picker.
  $('#reciter-picker-open').addEventListener('click', openReciterDialog);
  $('#reciter-dialog-close').addEventListener('click', closeReciterDialog);
  $$('[data-close-reciter]').forEach(element => element.addEventListener('click', closeReciterDialog));
  $('#reciter-grid').addEventListener('click', event => {
    const chip = event.target.closest('[data-reciter]');
    if (chip) chooseReciter(chip.dataset.reciter);
  });

  // Page index.
  $('#page-index-btn').addEventListener('click', openPageIndex);
  $('#page-index-close').addEventListener('click', closePageIndex);
  $$('[data-close-page-index]').forEach(element => element.addEventListener('click', closePageIndex));
  $('#page-index-search').addEventListener('input', event => filterPageIndex(event.target.value));
  $('#page-index-grid').addEventListener('click', async event => {
    const button = event.target.closest('.page-btn');
    if (!button) return;
    if (state.pageRepeat) stopPageRepeat();
    await choosePage(Number(button.dataset.page));
    setNavState('reader');
  });

  // Immersive mushaf mode.
  $('#focus-mode-btn').addEventListener('click', openMushafFullScreen);
  $('#focus-page-btn').addEventListener('click', openMushafFullScreen);
  $('#focus-exit').addEventListener('click', () => setFocusMode(false));
  $('#focus-prev').addEventListener('click', () => { if (state.pageIndex > 0) goToPage(state.pageIndex, false); });
  $('#focus-next').addEventListener('click', () => { if (state.pageIndex + 1 < (state.pageStarts.length || 604)) goToPage(state.pageIndex + 2, false); });
  $('#focus-page-input').addEventListener('change', event => {
    const page = Number(event.target.value);
    if (Number.isFinite(page)) goToPage(page, false);
    else updateFocusBar();
  });
  $('#focus-page-input').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); event.target.blur(); }
  });
  $('#focus-zoom-in').addEventListener('click', () => applyFontSize(state.fontSize + .15));
  $('#focus-zoom-reset').addEventListener('click', () => applyFontSize(DEFAULT_QURAN_FONT_SIZE));
  $('#focus-zoom-out').addEventListener('click', () => applyFontSize(state.fontSize - .15));
  $('#focus-page-index').addEventListener('click', openPageIndex);
  $('#focus-fullscreen').addEventListener('click', toggleBrowserFullscreen);
  document.addEventListener('fullscreenchange', updateFocusBar);

  // Dashboard navigation and live panels.
  $$('.dashboard-tab').forEach(button => button.addEventListener('click', () => showDashboardView(button.dataset.dashboardView)));
  $$('[data-open-reader]').forEach(button => button.addEventListener('click', () => setNavState('reader')));
  $('#confirm-page-read').addEventListener('click', markCurrentPageRead);
  $('#dashboard-continue').addEventListener('click', async () => { const lv=readStorage(STORAGE.lastView,null); const saved=getVerse(lv?.s,lv?.a)?lv:(state.lastConfirmedRead||{s:1,a:1}); await openSurah(saved.s,saved.a,true); setNavState('reader'); });
  $('#hero-browse').addEventListener('click', () => { setNavState('reader'); });
  $('#daily-ayah-play').addEventListener('click', () => playDailyVerse());
  $('#daily-ayah-open').addEventListener('click', openDailyVerseInReader);
  $('#dashboard-surah-select').addEventListener('change', event => renderSurahInformation(Number(event.target.value)));
  $('#surah-info-open').addEventListener('click', async () => { const sid=Number($('#dashboard-surah-select').value); await openSurah(sid,1,true); setNavState('reader'); });
  $('#album-prev-surah')?.addEventListener('click', () => changePlayerSurah(-1));
  $('#album-next-surah')?.addEventListener('click', () => changePlayerSurah(1));
  $('#album-play-toggle')?.addEventListener('click', togglePlayback);
  $('#album-open-mushaf')?.addEventListener('click', () => { setNavState('reader'); scrollToReader(); });
  $('#album-repeat')?.addEventListener('click', () => { state.playerRepeat=!state.playerRepeat; if(state.playerRepeat) state.playerAutoNext=false; updatePlayerModeButtons(); });
  $('#album-auto-next')?.addEventListener('click', () => { state.playerAutoNext=!state.playerAutoNext; if(state.playerAutoNext) state.playerRepeat=false; updatePlayerModeButtons(); });
  $('#studio-surah-list')?.addEventListener('click', event => { const item=event.target.closest('[data-studio-surah]'); if(item) selectStudioSurah(item.dataset.studioSurah); });
  $('#studio-reciter-list')?.addEventListener('click', event => { const item=event.target.closest('[data-studio-reciter]'); if(item) selectStudioReciter(item.dataset.studioReciter); });
  $('#studio-surah-search')?.addEventListener('input', event => renderStudioSurahList(event.target.value));
  $('#studio-reciter-search')?.addEventListener('input', event => renderStudioReciterList(event.target.value));
  $('#studio-progress')?.addEventListener('input', () => { state.isSeeking=true; const d=audio.duration||0; $('#studio-current-time').textContent=formatTime((Number($('#studio-progress').value)/1000)*d); paintRangeFill($('#studio-progress')); });
  $('#studio-progress')?.addEventListener('change', () => { if(Number.isFinite(audio.duration)&&audio.duration>0) audio.currentTime=(Number($('#studio-progress').value)/1000)*audio.duration; state.isSeeking=false; });
  $('#studio-volume')?.addEventListener('input', event => { audio.volume=Math.max(0,Math.min(1,Number(event.target.value))); writeStorage(STORAGE.audioVolume,audio.volume); $('#studio-mute').textContent=audio.volume===0?'◖×':'◖))'; paintRangeFill(event.target); });
  $('#studio-mute')?.addEventListener('click', () => { if(audio.volume>0){state.previousVolume=audio.volume;audio.volume=0;}else audio.volume=state.previousVolume||0.85; $('#studio-volume').value=String(audio.volume); writeStorage(STORAGE.audioVolume,audio.volume); $('#studio-mute').textContent=audio.volume===0?'◖×':'◖))'; });
  $('#studio-speed')?.addEventListener('change', event => { audio.playbackRate=Number(event.target.value)||1; $('#playback-speed').value=event.target.value; });
  $('#open-in-surah-player').addEventListener('click', openSurahInPlayer);
  $('#tafsir-surah-select').addEventListener('change', event => loadTafsirForSurah(Number(event.target.value)));
  $('#tafsir-ayah-number').addEventListener('change', () => { const max=getSurah(Number($('#tafsir-surah-select').value))?.array?.length||1; const value=Math.max(1,Math.min(max,Number($('#tafsir-ayah-number').value)||1)); $('#tafsir-ayah-number').value=String(value); renderSelectedTafsir(); });
  $('#tafsir-ayah-number').addEventListener('keydown', event => { if(event.key==='Enter'){event.preventDefault();$('#tafsir-ayah-number').dispatchEvent(new Event('change'));} });
  $('#tafsir-source-select').addEventListener('change', renderSelectedTafsir);
  $('#tafsir-read-ayah').addEventListener('click', async () => { const sid=Number($('#tafsir-surah-select').value), aid=Number($('#tafsir-ayah-number').value); await openSurah(sid,aid,false); await playAyah(aid); });
  $('#hadith-collection').addEventListener('change', event => { state.hadithCollectionCache.clear(); state.hadiths=[]; state.selectedHadith=0; loadHadithCollection(event.target.value).catch(error => { $('#hadith-list').innerHTML = `<p class="dashboard-note">${escapeHTML(error.message)} يمكن تنزيل المجموعة محلياً عبر أدوات المشروع.</p>`; }); });
  $('#hadith-search').addEventListener('input', event => renderHadithList(event.target.value));
  $('#hadith-list').addEventListener('click', event => { const item=event.target.closest('[data-hadith-index]'); if(!item)return; state.selectedHadith=Number(item.dataset.hadithIndex); renderHadithList(); });
  $('#share-progress-open').addEventListener('click', openProgressShareDialog);
  $('#progress-share-close').addEventListener('click', closeProgressShareDialog);
  $('#progress-share-cancel').addEventListener('click', closeProgressShareDialog);
  $$('[data-close-progress-share]').forEach(item=>item.addEventListener('click',closeProgressShareDialog));
  $('#progress-share-generate').addEventListener('click', generateProgressShareImage);

  // Desktop-only verse selection actions. Copy always uses the full local verse text with its diacritics.
  document.addEventListener('selectionchange', () => showAyahSelectionMenu(window.getSelection()));
  document.addEventListener('mouseup', () => setTimeout(() => showAyahSelectionMenu(window.getSelection()), 0));
  document.addEventListener('mousedown', event => { if(!event.target.closest('#ayah-selection-menu')) $('#ayah-selection-menu').hidden=true; });
  $('#selection-copy').addEventListener('click', async () => {
    const menu=$('#ayah-selection-menu'), sid=Number(menu.dataset.surah), aid=Number(menu.dataset.ayah), verse=getVerse(sid,aid);
    if(!verse)return;
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(verse.ar); copied = true; }
      else {
        const input = document.createElement('textarea');
        input.value = verse.ar; input.setAttribute('readonly', '');
        input.style.position = 'fixed'; input.style.opacity = '0';
        document.body.appendChild(input); input.select();
        copied = document.execCommand('copy'); input.remove();
      }
      if (!copied) throw new Error('Clipboard unavailable');
      showToast('تم نسخ الآية كاملة بالتشكيل.');
    } catch (_) { showToast('تعذر النسخ؛ تحقق من صلاحية الحافظة في المتصفح.'); }
    menu.hidden=true; window.getSelection()?.removeAllRanges();
  });
  $('#selection-play').addEventListener('click', async () => { const menu=$('#ayah-selection-menu'),sid=Number(menu.dataset.surah),aid=Number(menu.dataset.ayah); menu.hidden=true; if(sid!==state.activeSurah)await openSurah(sid,aid,false); await playAyah(aid); window.getSelection()?.removeAllRanges(); });
  $('#selection-tafsir').addEventListener('click', async () => { const menu=$('#ayah-selection-menu'),sid=Number(menu.dataset.surah),aid=Number(menu.dataset.ayah); menu.hidden=true; await openTafsirAt(sid,aid); window.getSelection()?.removeAllRanges(); });

  // Top bar surface while scrolling.
  const topbar = $('#topbar');
  const onScroll = () => topbar?.classList.toggle('scrolled', window.scrollY > 12);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Keyboard: close the topmost layer, open search.
  document.addEventListener('keydown', event => {
    const target = event.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (event.key === 'Escape') {
      if (!$('#search-overlay').hidden) { closeSearch(); return; }
      if (!$('#reciter-dialog').hidden) { closeReciterDialog(); return; }
      if (!$('#page-index-dialog').hidden) { closePageIndex(); return; }
      if (state.focusMode) { setFocusMode(false); return; }
      if (document.body.classList.contains('library-open')) { setLibraryOpen(false); return; }
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    }
    if ((event.key === '/' && !typing) || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      openSearch();
    }
  });

  initialize();
})();
