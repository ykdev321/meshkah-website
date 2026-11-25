/* مكتبة الأحاديث — صفحة مستقلة بنفس منطق قسم الأحاديث في الصفحة الرئيسية. */
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const THEME_KEY = 'mishkat.theme.v2';

  const state = {
    hadiths: [],
    selectedHadith: 0,
    collectionId: 'nawawi',
    collectionName: 'الأربعون النووية',
    collectionCache: new Map(),
    toastTimer: null
  };

  const HADITH_COLLECTIONS = {
    nawawi: { name: 'الأربعون النووية', edition: 'ara-nawawi', file: 'ara-nawawi.min.json', min: 42 },
    bukhari: { name: 'صحيح البخاري', edition: 'ara-bukhari', file: 'ara-bukhari.min.json', min: 1000 },
    muslim: { name: 'صحيح مسلم', edition: 'ara-muslim', file: 'ara-muslim.min.json', min: 1000 },
    abudawud: { name: 'سنن أبي داود', edition: 'ara-abudawud', file: 'ara-abudawud.min.json', min: 1000 },
    tirmidhi: { name: 'جامع الترمذي', edition: 'ara-tirmidhi', file: 'ara-tirmidhi.min.json', min: 1000 },
    nasai: { name: 'سنن النسائي', edition: 'ara-nasai', file: 'ara-nasai.min.json', min: 1000 },
    ibnmajah: { name: 'سنن ابن ماجه', edition: 'ara-ibnmajah', file: 'ara-ibnmajah.min.json', min: 1000 }
  };

  function toArabicDigits(value) {
    return String(value).replace(/[0-9]/g, digit => ARABIC_DIGITS[Number(digit)]);
  }
  function normalizeArabic(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[ً-ٰٟۖ-ۭ]/g, '')
      .replace(/[أإآٱ]/g, 'ا')
      .replace(/ى/g, 'ي')
      .replace(/ة/g, 'ه')
      .replace(/[ًٌٍَُِّْـ]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }
  function escapeHTML(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }
  function showToast(message) {
    const toast = $('#toast');
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  function validateHadithEdition(data, config) {
    if (!data || !Array.isArray(data.hadiths)) throw new Error('صيغة مجموعة الأحاديث غير صحيحة.');
    const entries = data.hadiths.filter(item => item && typeof item.text === 'string' && item.text.trim());
    if (entries.length < config.min) throw new Error(`مجموعة ${config.name} ناقصة: ${entries.length} حديثاً فقط.`);
    return entries;
  }

  async function loadHadithCollection(collectionId = $('#hadith-collection')?.value || state.collectionId) {
    const config = HADITH_COLLECTIONS[collectionId] || HADITH_COLLECTIONS.nawawi;
    state.collectionId = collectionId;
    state.collectionName = config.name;
    if (state.collectionCache.has(collectionId)) {
      state.hadiths = state.collectionCache.get(collectionId);
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
    state.collectionCache.clear();
    state.collectionCache.set(collectionId, state.hadiths);
    state.selectedHadith = 0;
    renderHadithList();
  }

  function renderHadithList(query = $('#hadith-search')?.value || '') {
    const q = normalizeArabic(query);
    const matches = state.hadiths.map((hadith, index) => ({ ...hadith, index })).filter(h => !q || normalizeArabic(h.text).includes(q) || String(h.number).includes(q));
    $('#hadith-list').innerHTML = matches.map(h => `<button class="hadith-item ${h.index === state.selectedHadith ? 'active' : ''}" data-hadith-index="${h.index}">الحديث ${toArabicDigits(h.number)}</button>`).join('') || '<p class="dashboard-note">لا توجد نتائج مطابقة.</p>';
    const selected = state.hadiths[state.selectedHadith];
    $('#hadith-heading-title').textContent = state.collectionName || 'مكتبة الأحاديث';
    if (selected) {
      $('#hadith-title').textContent = `الحديث ${toArabicDigits(selected.number)}`;
      $('#hadith-text').textContent = selected.text;
      $('#hadith-reference').textContent = selected.reference;
    } else {
      $('#hadith-title').textContent = state.collectionName;
      $('#hadith-text').textContent = 'لا يوجد حديث مطابق للبحث الحالي.';
      $('#hadith-reference').textContent = '';
    }
  }

  async function copySelectedHadith() {
    const selected = state.hadiths[state.selectedHadith];
    if (!selected) { showToast('اختر حديثاً أولاً.'); return; }
    const text = `${selected.text}\n\n[${selected.reference}]`;
    try {
      let copied = false;
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); copied = true; }
      else {
        const input = document.createElement('textarea');
        input.value = text; input.setAttribute('readonly', '');
        input.style.position = 'fixed'; input.style.opacity = '0';
        document.body.appendChild(input); input.select();
        copied = document.execCommand('copy'); input.remove();
      }
      if (!copied) throw new Error('Clipboard unavailable');
      showToast('تم نسخ الحديث إلى الحافظة.');
    } catch (_) {
      showToast('تعذر النسخ؛ تحقق من صلاحية الحافظة في المتصفح.');
    }
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
    try { localStorage.setItem(THEME_KEY, JSON.stringify(light ? 'light' : 'dark')); } catch (_) { /* private mode */ }
  }

  applyTheme(readTheme());
  $('#theme-toggle').addEventListener('click', () => applyTheme(document.body.classList.contains('light-theme') ? 'dark' : 'light'));

  const topbar = $('#topbar');
  const onScroll = () => topbar?.classList.toggle('scrolled', window.scrollY > 12);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  $('#hadith-collection').addEventListener('change', event => {
    state.collectionCache.clear();
    state.hadiths = [];
    state.selectedHadith = 0;
    loadHadithCollection(event.target.value).catch(error => {
      $('#hadith-list').innerHTML = `<p class="dashboard-note">${escapeHTML(error.message)} تحقق من اتصال الإنترنت عند فتح الكتاب أول مرة.</p>`;
    });
  });
  $('#hadith-search').addEventListener('input', event => renderHadithList(event.target.value));
  $('#hadith-list').addEventListener('click', event => {
    const item = event.target.closest('[data-hadith-index]');
    if (!item) return;
    state.selectedHadith = Number(item.dataset.hadithIndex);
    renderHadithList();
  });
  $('#hadith-copy').addEventListener('click', copySelectedHadith);

  loadHadithCollection().catch(error => {
    $('#hadith-list').innerHTML = `<p class="dashboard-note">${escapeHTML(error.message)} تحقق من اتصال الإنترنت عند فتح الكتاب أول مرة.</p>`;
  });
})();
