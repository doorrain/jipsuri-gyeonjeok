// 앱 화면 파일을 저장해 두어 현장에서 신호가 약해도 열리게 합니다.
const CACHE = 'gyeonjeok-v20';
const SHELL = [
  './', './index.html', './css/style.css', './manifest.webmanifest', './config.js',
  './js/app.js', './js/store.js', './js/rescue.js', './js/seed.js', './js/util.js', './js/quote.js', './js/pdf.js', './js/contract.js', './js/sign.js',
  './icons/icon.svg', './icons/icon-192.png',
];
self.addEventListener('install', (e) => {
  // 휴대폰 브라우저에 남아 있는 예전 파일 말고 서버의 새 파일로 저장
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('gyeonjeok-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
// 인터넷이 되면 항상 최신 파일, 안 되면 저장해 둔 파일
// (GitHub는 파일을 10분까지 재사용하라고 알려 주므로, 앱 파일은 매번 서버에 새 버전이 있는지 확인)
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const cacheable = url.origin === location.origin || /cdnjs\.cloudflare\.com|fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.href);
  if (!cacheable || /supabase\.co/.test(url.href)) return;
  e.respondWith(
    (url.origin !== location.origin ? fetch(req)
      : req.mode === 'navigate' ? fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
      : fetch(req, { cache: 'no-cache' }))
      .then((res) => {
        if (res.ok || res.type === 'opaque') {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
