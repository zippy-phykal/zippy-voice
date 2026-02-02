const CACHE_NAME = 'zippy-voice-v5';

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  // Never intercept API calls or audio
  if (e.request.url.includes('/v1/') || e.request.url.includes('/api/') || e.request.url.includes('/audio/')) return;

  e.respondWith(
    fetch(e.request).catch(() =>
      new Response(
        '<!DOCTYPE html><html><body style="background:#1a1a2e;color:#fff;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif"><h1>⚡ Zippy Voice is offline</h1></body></html>',
        { headers: { 'Content-Type': 'text/html' } }
      )
    )
  );
});
