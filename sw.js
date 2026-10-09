// Service Worker — يخزّن "هيكل" التطبيق فقط (لا بيانات الزبائن ولا طلبات الخادم)
var VERSION = 'v1';
var SHELL = 'zc-shell-' + VERSION;
var FONTS = 'zc-fonts-v1';
var FILES = ['./', 'index.html', 'style.css', 'app.js', 'api.js', 'config.js', 'pwa.js',
             'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(SHELL).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== SHELL && k !== FONTS; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function networkFirst(req) {
  return new Promise(function (resolve) {
    var done = false;
    var t = setTimeout(function () {
      caches.match(req).then(function (hit) { if (hit && !done) { done = true; resolve(hit); } });
    }, 3000);
    fetch(req).then(function (res) {
      clearTimeout(t);
      if (res && res.ok) { var copy = res.clone(); caches.open(SHELL).then(function (c) { c.put(req, copy); }); }
      if (!done) { done = true; resolve(res); }
    }).catch(function () {
      clearTimeout(t);
      caches.match(req).then(function (hit) { if (!done) { done = true; resolve(hit || Response.error()); } });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;           // طلبات API (POST) لا تمرّ هنا إطلاقاً
  var url = new URL(req.url);

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open(FONTS).then(function (c) {
      return c.match(req).then(function (hit) {
        var net = fetch(req).then(function (res) { c.put(req, res.clone()); return res; }).catch(function () { return hit; });
        return hit || net;
      });
    }));
    return;
  }

  if (url.origin === location.origin) {
    var path = url.pathname;
    if (req.mode === 'navigate') {
      e.respondWith(networkFirst(new Request(new URL('index.html', self.registration.scope).href)));
    } else {
      e.respondWith(networkFirst(req));
    }
  }
});
