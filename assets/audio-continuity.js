/* ============================================================
   مشكاة — مشغل التلاوة المصغّر عبر صفحات الموقع (v8.5)
   On pages without the full player (no #audio element) this picks up the
   recitation session saved by the reader/player pages, resumes it, and
   keeps the session fresh so moving between pages never stops the audio.
   ============================================================ */
(() => {
  'use strict';
  if (document.querySelector('#audio')) return; // reader/player pages resume natively

  const SESSION_KEY = 'mishkat.audioSession.v1';
  const VOLUME_KEY = 'mishkat.audioVolume.v1';
  const FRESH_MS = 60000;
  const METADATA_WAIT_MS = 20000;
  const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  const toArabicDigits = (value) => String(value).replace(/[0-9]/g, (digit) => ARABIC_DIGITS[Number(digit)]);
  const formatTime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return '٠:٠٠';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
    return `${toArabicDigits(mins)}:${toArabicDigits(secs)}`;
  };

  const readSession = () => {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  };
  const writeSession = (value) => {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(value)); } catch (_) { /* storage unavailable */ }
  };

  const session = readSession();
  if (!session || session.playing !== true || typeof session.url !== 'string' || !session.url) return;
  if (!Number.isFinite(Number(session.at)) || Date.now() - Number(session.at) > FRESH_MS) return;

  let volume = 0.85;
  try {
    const saved = Number(JSON.parse(localStorage.getItem(VOLUME_KEY)));
    if (Number.isFinite(saved)) volume = Math.max(0, Math.min(1, saved));
  } catch (_) { /* keep default */ }

  const startAt = Math.max(0, Number(session.time) || 0);
  const clipEnd = session.mode === 'clip' && Number(session.clipEnd) > startAt ? Number(session.clipEnd) : null;

  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = volume;
  if (Number(session.rate) > 0) audio.playbackRate = Number(session.rate);

  const bar = document.createElement('div');
  bar.className = 'continuity-bar';
  bar.id = 'continuity-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'مشغل التلاوة المصغر');
  bar.innerHTML = `
    <button type="button" class="continuity-toggle" aria-label="تشغيل">
      <svg viewBox="0 0 24 24" class="icon-play" aria-hidden="true"><path d="m8 5 11 7-11 7z"></path></svg>
      <svg viewBox="0 0 24 24" class="icon-pause" aria-hidden="true" hidden><path d="M8 5h3v14H8zM15 5h3v14h-3z"></path></svg>
    </button>
    <div class="continuity-copy">
      <strong class="continuity-title"></strong>
      <small class="continuity-sub"></small>
    </div>
    <span class="continuity-time">٠:٠٠</span>
    <a class="continuity-open" href="player.html" aria-label="فتح المشغل الكامل" title="فتح المشغل الكامل">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 13v-1a9 9 0 0 1 18 0v1M3 13h4v7H5a2 2 0 0 1-2-2zM21 13h-4v7h2a2 2 0 0 0 2-2z"></path></svg>
    </a>
    <button type="button" class="continuity-close" aria-label="إيقاف التلاوة وإغلاق المشغل">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"></path></svg>
    </button>`;
  const toggleBtn = bar.querySelector('.continuity-toggle');
  const iconPlay = bar.querySelector('.icon-play');
  const iconPause = bar.querySelector('.icon-pause');
  const titleEl = bar.querySelector('.continuity-title');
  const subEl = bar.querySelector('.continuity-sub');
  const timeEl = bar.querySelector('.continuity-time');
  titleEl.textContent = session.surahName ? `سورة ${session.surahName}` : 'التلاوة';

  let started = false;  // playback actually began on this page
  let failed = false;   // the audio source errored; the toggle becomes "retry"
  let lastSave = 0;
  let metadataWatch = 0;

  function paint() {
    const playing = !audio.paused && !audio.ended;
    iconPlay.hidden = playing;
    iconPause.hidden = !playing;
    toggleBtn.setAttribute('aria-label', playing ? 'إيقاف مؤقت' : (failed ? 'إعادة المحاولة' : 'تشغيل'));
    bar.classList.toggle('continuity-error', failed);
    subEl.textContent = failed
      ? 'تعذّر تشغيل الصوت من الخادم. اضغط إعادة المحاولة، أو افتح المشغل الكامل واختر قارئًا آخر.'
      : (session.reciterName || '');
  }

  function persist(playingOverride) {
    const playing = playingOverride !== undefined ? playingOverride
      : ((!audio.paused && !audio.ended) || (!started && !failed));
    writeSession({
      ...session,
      time: audio.currentTime || startAt,
      playing,
      rate: audio.playbackRate || 1,
      at: started ? Date.now() : session.at
    });
  }

  function clearMetadataWatch() {
    if (metadataWatch) { clearTimeout(metadataWatch); metadataWatch = 0; }
  }

  async function attemptPlay() {
    try {
      await audio.play();
    } catch (error) {
      // NotAllowedError: the browser wants one tap before sound; the bar stays
      // as that tap target and the session keeps its original freshness window.
      failed = !(error && error.name === 'NotAllowedError');
      paint();
    }
  }

  function begin() {
    if (startAt > 0 && audio.readyState < 1) {
      audio.addEventListener('loadedmetadata', () => {
        const ceiling = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.max(0, audio.duration - 0.5) : startAt;
        audio.currentTime = Math.min(startAt, ceiling);
        attemptPlay();
      }, { once: true });
    } else {
      if (startAt > 0) {
        const ceiling = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.max(0, audio.duration - 0.5) : startAt;
        audio.currentTime = Math.min(startAt, ceiling);
      }
      attemptPlay();
    }
    metadataWatch = setTimeout(() => {
      metadataWatch = 0;
      if (!started && !failed) { failed = true; paint(); }
    }, METADATA_WAIT_MS);
  }

  audio.addEventListener('timeupdate', () => {
    timeEl.textContent = formatTime(audio.currentTime);
    if (clipEnd && audio.currentTime >= clipEnd - 0.05) {
      audio.pause();
      persist(false);
      bar.remove();
      document.body.classList.remove('has-continuity-bar');
      return;
    }
    const now = Date.now();
    if (now - lastSave > 1000) { lastSave = now; persist(); }
  });
  audio.addEventListener('play', () => { started = true; failed = false; clearMetadataWatch(); paint(); persist(true); });
  audio.addEventListener('pause', () => { paint(); persist(); });
  audio.addEventListener('ended', () => {
    persist(false);
    bar.remove();
    document.body.classList.remove('has-continuity-bar');
  });
  audio.addEventListener('error', () => {
    if (!audio.src) return;
    clearMetadataWatch();
    failed = true;
    paint();
    persist(false);
  });

  toggleBtn.addEventListener('click', () => {
    if (failed) {
      failed = false;
      paint();
      audio.src = session.url;
      audio.load();
      begin();
      return;
    }
    if (audio.paused || audio.ended) attemptPlay();
    else audio.pause();
  });

  bar.querySelector('.continuity-close').addEventListener('click', () => {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    persist(false);
    bar.remove();
    document.body.classList.remove('has-continuity-bar');
  });

  window.addEventListener('pagehide', () => persist());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') persist(); });

  paint();
  document.body.appendChild(bar);
  document.body.classList.add('has-continuity-bar');
  audio.src = session.url;
  audio.load();
  begin();
})();
