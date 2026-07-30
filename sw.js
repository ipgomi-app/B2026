/* ENG — Service Worker
   - HTML 문서: network-first (온라인이면 항상 최신, 오프라인이면 캐시)
   - 정적 자원(아이콘·폰트 등): cache-first */
const CACHE = "eng-app-v10";
const APP_HTML = "index.html";
/* PDF는 캐시하지 않는다 — 뷰어가 쓰는 Range(206) 요청을 서비스워커가 가로채면
   안드로이드 Chrome에서 PDF가 열리지 않는다. 항상 네트워크가 직접 처리. */
const ASSETS = [
  APP_HTML,
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
  "apple-touch-icon.png",
  "pdfjs/pdf.min.js",
  "pdfjs/pdf.worker.min.js",
  "vendor/three.module.min.js",
  "vendor/three.core.min.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  // PDF·Range 요청은 서비스워커가 건드리지 않는다(안드로이드 PDF 뷰어 호환)
  if (req.url.split("?")[0].endsWith(".pdf") || req.headers.has("range")) return;

  const isDoc = req.mode === "navigate" ||
                (req.destination === "document") ||
                req.url.endsWith(APP_HTML);

  if (isDoc) {
    // network-first: 최신 HTML 우선, 실패 시 캐시
    e.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => { try { c.put(req, copy); } catch (_) {} });
        return resp;
      }).catch(() => caches.match(req).then(r => r || caches.match(APP_HTML)))
    );
    return;
  }

  // cache-first: 정적 자원
  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => { try { c.put(req, copy); } catch (_) {} });
      return resp;
    }).catch(() => cached))
  );
});
