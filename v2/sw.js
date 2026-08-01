/* ENG v2 — Service Worker (scope: /v2/)
   - HTML 문서: network-first (온라인이면 항상 최신, 오프라인이면 캐시)
   - 정적 자원(three.js·pdf.js·아이콘 등): cache-first
   ★ 기존 앱(/)의 서비스워커(eng-app-*)와 캐시를 공유하지 않는다.
     activate에서 자기 접두사(eng-v2-)로 시작하는 캐시만 정리한다 —
     전체를 지우면 루트 앱의 오프라인 캐시까지 날아간다. */
const PREFIX = "eng-v2-";
const CACHE  = PREFIX + "1";
const APP_HTML = "index.html";

/* 공용 자원은 상위 경로(../)를 그대로 참조한다. 스코프 밖 URL도 캐시는 가능하다. */
const ASSETS = [
  APP_HTML,
  "manifest.webmanifest",
  "../icon-192.png",
  "../icon-512.png",
  "../apple-touch-icon.png",
  "../pdfjs/pdf.min.js",
  "../pdfjs/pdf.worker.min.js",
  "../vendor/three.module.min.js",
  "../vendor/three.core.min.js"
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // 개별 실패가 설치 전체를 막지 않도록 하나씩 담는다
      .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(
        ks.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  // PDF·Range 요청은 건드리지 않는다(안드로이드 PDF 뷰어 호환)
  if (req.url.split("?")[0].endsWith(".pdf") || req.headers.has("range")) return;

  const isDoc = req.mode === "navigate" ||
                (req.destination === "document") ||
                req.url.endsWith(APP_HTML);

  if (isDoc) {
    e.respondWith(
      fetch(req).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE).then(c => { try { c.put(req, copy); } catch (_) {} });
        return resp;
      }).catch(() => caches.match(req).then(r => r || caches.match(APP_HTML)))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(cached => cached || fetch(req).then(resp => {
      const copy = resp.clone();
      caches.open(CACHE).then(c => { try { c.put(req, copy); } catch (_) {} });
      return resp;
    }).catch(() => cached))
  );
});
