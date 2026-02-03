import type { TelegramClient } from '@mtcute/web';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessageType = any;

export class StreamingAudioDownloader {
    private abortController: AbortController;

    constructor() {
        this.abortController = new AbortController();
    }

    async startStreaming(
        client: TelegramClient,
        message: MessageType,
        mimeType: string,
        onProgress?: (progress: number) => void
    ): Promise<string> {
        if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
            throw new Error('Service Worker not active. Cannot stream.');
        }

        const streamId = Math.random().toString(36).substring(7);
        // Create a TransformStream
        // The readable side goes to the Service Worker (to be served to the audio element)
        // The writable side stays here (to receive data from Telegram)
        const { readable, writable } = new TransformStream();

        // Send the readable stream to the Service Worker
        const msg = {
            type: 'REGISTER_STREAM',
            id: streamId,
            stream: readable,
            mimeType: mimeType,
            size: message.media?.fileSize || 0
        };

        navigator.serviceWorker.controller.postMessage(msg, [readable]);

        // Start the download in the background via the writable side
        this.downloadToStream(client, message, writable, onProgress);

        return `/stream/${streamId}`;
    }

    private async downloadToStream(
        client: TelegramClient,
        message: MessageType,
        writableStream: WritableStream,
        onProgress?: (progress: number) => void
    ) {
        const writer = writableStream.getWriter();
        const doc = message.media;
        const fileSize = doc.fileSize || 0;
        let totalDownloaded = 0;

        try {
            console.log('Starting stream download...');
            for await (const chunk of client.downloadAsIterable(doc)) {
                if (this.abortController.signal.aborted) {
                    throw new Error('Aborted');
                }

                // Chunk is Uint8Array, write directly
                await writer.write(chunk);

                totalDownloaded += chunk.length;
                if (onProgress && fileSize > 0) {
                    onProgress((totalDownloaded / fileSize) * 100);
                }
            }
            console.log('Stream download complete');
            await writer.close();
        } catch (error) {
            console.error('Stream download error:', error);
            try {
                await writer.abort(error);
            } catch (e) {
                // Ignore errors during abort
            }
        }
    }

    cleanup() {
        this.abortController.abort();
    }
}
