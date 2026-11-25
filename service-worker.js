// Mishkat v8.3 — keeps every downloaded hadith edition side by side and falls back to the app shell for the bundled one.
const CACHE_NAME = 'mishkat-app-v8-4-0-onboarding-tour';
const TAFSIR_CACHE = 'mishkat-tafsir-v1';
const HADITH_CACHE = 'mishkat-hadith-local-v2';
const APP_FILES = [
  './','./index.html','./player.html','./about.html','./privacy.html','./hadith.html','./tafsir.html','./assets/styles.css','./assets/app.js','./assets/about.js','./assets/hadith.js','./assets/tafsir.js',
  './assets/fonts/readex-pro-ar.woff2','./assets/fonts/readex-pro-latin.woff2','./assets/fonts/amiri-400-ar.woff2','./assets/fonts/amiri-700-ar.woff2','./assets/fonts/noto-naskh-arabic-ar.woff2',
  './manifest.webmanifest','./icons/favicon.svg','./icons/logo-mishkat.png','./data/quran.json','./data/reciters.json','./data/verse-to-page.json','./data/tafsir/index.json','./data/hadith/ara-nawawi.min.json'
];
self.addEventListener('install', event => {
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    for(const file of APP_FILES){try{await cache.add(file)}catch(error){console.warn(`Could not cache ${file}:`,error)}}
  })());
  self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => (key.startsWith('mishkat-app-') && key !== CACHE_NAME) || key === 'mishkat-quran-v3' || key === 'mishkat-hadith-local-v1').map(key => caches.delete(key)))));
  self.clients.claim();
});
async function trimTafsirCache(cache, keep=5) {
  const keys=await cache.keys();
  if(keys.length<=keep)return;
  for(const request of keys.slice(0,keys.length-keep)) await cache.delete(request);
}
self.addEventListener('fetch', event => {
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin)return;
  if(url.pathname.includes('/data/pages/')){
    // Mushaf page layouts are stored in their own resumable cache bucket by app.js.
    // Avoid duplicating all 604 files inside the application-shell cache.
    event.respondWith(fetch(request));
    return;
  }
  if(url.pathname.includes('/data/tafsir/')){
    event.respondWith((async()=>{
      const cache=await caches.open(TAFSIR_CACHE);
      const cached=await cache.match(request);
      if(cached)return cached;
      const response=await fetch(request);
      if(response.ok){try{await cache.put(request,response.clone());await trimTafsirCache(cache,5)}catch(_){}}
      return response;
    })());
    return;
  }
  if(url.pathname.includes('/data/hadith/')){
    event.respondWith((async()=>{
      const cache=await caches.open(HADITH_CACHE);
      const cached=await cache.match(request);
      if(cached)return cached;
      try{
        const response=await fetch(request);
        if(response.ok){
          // Keep every downloaded edition side by side; deleting the other keys
          // here is what silently wiped the previously saved books offline.
          try{const candidate=await response.clone().json();if(Array.isArray(candidate.hadiths)&&candidate.hadiths.length>0&&candidate.hadiths.some(item=>typeof item?.text==='string'&&item.text.trim()))await cache.put(request,response.clone())}catch(_){}
        }
        return response
      }catch(error){
        // The bundled edition is also precached in the application shell,
        // so it stays readable offline even before this bucket holds a copy.
        try{const shell=await caches.open(CACHE_NAME);const shellCached=await shell.match(request);if(shellCached)return shellCached}catch(_){}
        throw error}
    })());
    return;
  }
  if(url.pathname.includes('/data/')){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME),cached=await cache.match(request);
      if(cached)return cached;
      const response=await fetch(request);
      if(response.ok){try{await cache.put(request,response.clone())}catch(_){}}
      return response;
    })());
    return;
  }
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    try{const response=await fetch(request);if(response.ok){try{await cache.put(request,response.clone())}catch(_){}}return response}
    catch(error){const cached=await cache.match(request);if(cached)return cached;throw error}
  })());
});
