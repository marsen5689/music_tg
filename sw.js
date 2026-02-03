const map = new Map();

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'REGISTER_STREAM') {
        const { id, stream, mimeType, size } = event.data;
        map.set(id, { stream, mimeType, size });
        console.log('[SW] Stream registered:', id);
    }
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Robust check for /stream/{id} that handles base paths (e.g. /repo/stream/123)
    const streamMatch = url.pathname.match(/\/stream\/([^/]+)$/);

    if (streamMatch) {
        const id = streamMatch[1];
        const data = map.get(id);

        if (data) {
            console.log('[SW] Serving stream:', id);

            const headers = new Headers();
            headers.set('Content-Type', data.mimeType || 'audio/mpeg');
            if (data.size) {
                headers.set('Content-Length', data.size);
            }
            headers.set('Accept-Ranges', 'bytes');

            event.respondWith(new Response(data.stream, { headers }));
            map.delete(id);
        }
    }
});
