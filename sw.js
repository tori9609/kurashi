// 画面の部品をiPhoneに覚えさせて、2回目から速く開くための仕組み
const CACHE = 'kurashi-v5';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'features.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  // データベースの部品(esm.sh)は、圏外でも起動できるよう覚えておく(あれば覚えた分をすぐ使い、裏で新しくする)
  if (u.hostname === 'esm.sh') {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit => {
      const net = fetch(e.request).then(r => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }
  if (u.origin !== location.origin) return;   // データの通信は覚えない
  // 毎回サーバーに新しい版がないか確かめる(GitHub Pages の10分の保存を待たずに、更新がすぐ届くように)
  e.respondWith(fetch(new Request(e.request.url, { cache: 'no-cache' })).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; })
    .catch(() => caches.match(e.request)));
});

// 通知を受け取って表示する(暮らし帳の通知係から届く)
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || '暮らし帳', {
    body: d.body || '', tag: d.tag, data: { url: d.url || './' }, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }));
});
// 通知を押したら、その画面を開く(開いていれば切り替える)
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(ws => {
    for (const w of ws) if ('focus' in w) return (w.navigate ? w.navigate(url) : Promise.resolve()).then(() => w.focus());
    return self.clients.openWindow(url);
  }));
});
