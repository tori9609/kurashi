// 画面の部品をiPhoneに覚えさせて、2回目から速く開くための仕組み
const CACHE = 'kurashi-v3';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'features.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;   // データの通信は覚えない
  // 毎回サーバーに新しい版がないか確かめる(GitHub Pages の10分の保存を待たずに、更新がすぐ届くように)
  e.respondWith(fetch(new Request(e.request.url, { cache: 'no-cache' })).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});
