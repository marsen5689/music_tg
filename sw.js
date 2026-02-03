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
    if (url.pathname.startsWith('/stream/')) {
        const id = url.pathname.split('/stream/')[1];
        const data = map.get(id);

        if (data) {
            console.log('[SW] Serving stream:', id);

            const headers = new Headers();
            headers.set('Content-Type', data.mimeType || 'audio/mpeg');
            if (data.size) {
                headers.set('Content-Length', data.size);
            }
            headers.set('Accept-Ranges', 'bytes'); // Fake support implies we assume browser handles continuous stream

            event.respondWith(new Response(data.stream, { headers }));

            // We can remove the stream from map if it's one-time use, 
            // but keeping it allows re-requests (seeking partially works if browser buffers)
            // For now, let's keep it until explicitly cleared? 
            // Actually, Response consumes the stream, so we can't reuse it easily without teeing.
            // So we remove it.
            map.delete(id);
        }
    }
});
