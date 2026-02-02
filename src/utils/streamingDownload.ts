import type { TelegramClient } from '@mtcute/web';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MessageType = any;
export class StreamingAudioDownloader {
    private mediaSource: MediaSource;
    private sourceBuffer: SourceBuffer | null = null;
    private chunks: Uint8Array[] = [];
    private isAppending = false;
    private downloadComplete = false;
    private isAborted = false;

    constructor() {
        this.mediaSource = new MediaSource();
    }

    async startStreaming(
        client: TelegramClient,
        message: MessageType,
        mimeType: string,
        onProgress?: (progress: number) => void
    ): Promise<string> {
        // Validate codec support
        if (!MediaSource.isTypeSupported(mimeType)) {
            const compatibleTypes = [
                'audio/mpeg',
                'audio/mp4; codecs="mp4a.40.2"',
                'audio/webm; codecs="opus"'
            ];

            const supported = compatibleTypes.find(type =>

                type.startsWith(mimeType.split('/')[0]) && MediaSource.isTypeSupported(type)
            );

            if (!supported && mimeType !== 'audio/mp4' && mimeType !== 'audio/webm') {
                console.warn(`MediaSource usually does not support ${mimeType}, triggering fallback.`);
                throw new Error(`MIME type ${mimeType} not supported by MediaSource`);
            }
        }

        const url = URL.createObjectURL(this.mediaSource);

        const handleSourceOpen = async () => {
            try {
                if (this.mediaSource.readyState !== 'open') {
                    return;
                }

                console.log('MediaSource open. Using mimeType:', mimeType);

                let targetMime = mimeType;
                if (!MediaSource.isTypeSupported(targetMime)) {
                    if (MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"')) {
                        targetMime = 'audio/mp4; codecs="mp4a.40.2"';
                    } else if (MediaSource.isTypeSupported('audio/mpeg')) {
                        targetMime = 'audio/mpeg';
                    }
                }

                // Try to set duration from metadata if available
                try {
                    if (message.media?.type === 'document' && message.media.type === 'audio') {
                        const audio = message.media as { duration?: number };
                        if (audio.duration) {
                            this.mediaSource.duration = audio.duration;
                        }
                    }
                } catch (e) {
                    console.warn('Failed to set MediaSource duration:', e);
                }

                try {
                    this.sourceBuffer = this.mediaSource.addSourceBuffer(targetMime);
                } catch (e) {
                    console.error('Failed to add SourceBuffer with type:', targetMime, e);
                    throw e;
                }

                this.sourceBuffer.addEventListener('updateend', () => {
                    this.isAppending = false;
                    this.processQueue();
                });

                this.sourceBuffer.addEventListener('error', (e) => {
                    console.error('SourceBuffer error:', e);
                });

                // Start downloading
                await this.downloadInChunks(client, message, onProgress);
            } catch (error) {
                console.error('Streaming error in handleSourceOpen:', error);

                try {
                    if (this.mediaSource.readyState === 'open') {
                        this.mediaSource.endOfStream('decode');
                    }
                } catch (e) {
                    // ignore
                }
            }
        };

        this.mediaSource.addEventListener('sourceopen', handleSourceOpen);

        this.mediaSource.addEventListener('sourceclose', () => {
            console.log('MediaSource closed');
        });

        return url;
    }

    private async downloadInChunks(
        client: TelegramClient,
        message: MessageType,
        onProgress?: (progress: number) => void
    ) {
        if (!message.media || message.media.type !== 'document') {
            throw new Error('Invalid media');
        }

        const doc = message.media;
        const fileSize = doc.fileSize || 0;
        console.log('Starting streaming download, file size:', fileSize);

        let totalDownloaded = 0;

        try {
            // Use downloadIterable for chunked downloads
            for await (const chunk of client.downloadAsIterable(doc)) {
                if (this.isAborted) {
                    throw new Error('DOWNLOAD_ABORTED');
                }

                if (!chunk || chunk.length === 0) continue;

                // Convert to Uint8Array
                const data = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);

                this.chunks.push(data);
                this.processQueue();

                totalDownloaded += data.length;

                if (onProgress && fileSize > 0) {
                    onProgress((totalDownloaded / fileSize) * 100);
                }
            }

            if (!this.isAborted) {
                console.log('Download complete, total size:', totalDownloaded);
                this.downloadComplete = true;
                this.finalizeStream();
            }
        } catch (error) {
            if (error instanceof Error && error.message === 'DOWNLOAD_ABORTED') {
                console.log('Download aborted');
            } else {
                console.error('Streaming download error:', error);
                throw error;
            }
        }
    }

    private processQueue() {
        if (this.isAppending || !this.sourceBuffer || this.chunks.length === 0 || this.isAborted) {
            return;
        }

        if (this.sourceBuffer.updating) {
            return;
        }

        const chunk = this.chunks.shift();
        if (chunk) {
            try {
                this.isAppending = true;
                // Cast to ArrayBuffer to satisfy TypeScript BufferSource type
                this.sourceBuffer.appendBuffer(chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
            } catch (error) {
                console.error('Error appending buffer:', error);
                this.isAppending = false;
            }
        }
    }

    private finalizeStream() {
        if (this.downloadComplete && this.chunks.length === 0 && !this.isAppending) {
            if (this.mediaSource.readyState === 'open' && !this.isAborted) {
                try {
                    this.mediaSource.endOfStream();
                    console.log('Stream finalized');
                } catch (error) {
                    console.error('Error finalizing stream:', error);
                }
            }
        } else if (!this.isAborted) {
            setTimeout(() => this.finalizeStream(), 100);
        }
    }

    cleanup() {
        this.isAborted = true;
        if (this.mediaSource.readyState === 'open') {
            try {
                this.mediaSource.endOfStream();
            } catch (error) {
                // Ignore
            }
        }
    }
}
