import { Api } from 'telegram';
import type { TelegramClient } from 'telegram';

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
        message: Api.Message,
        mimeType: string,
        onProgress?: (progress: number) => void
    ): Promise<string> {
        // Validate codec support immediately
        // MediaSource requires full codec string mainly for video, but for audio simple mime types usually work 
        // if supported. However, Chrome often lacks audio/mpeg support in MSE.
        if (!MediaSource.isTypeSupported(mimeType)) {
            // Check for common variations if strict check fails
            const compatibleTypes = [
                'audio/mpeg',
                'audio/mp4; codecs="mp4a.40.2"',
                'audio/webm; codecs="opus"'
            ];

            const supported = compatibleTypes.find(type => type.startsWith(mimeType.split('/')[0]) && MediaSource.isTypeSupported(type));

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

                // Use the provided mimeType, or a safe fallback if necessary
                let targetMime = mimeType;
                if (!MediaSource.isTypeSupported(targetMime)) {
                    // Try to find a compatible container if original fails (e.g. mpeg -> mp4)
                    if (MediaSource.isTypeSupported('audio/mp4; codecs="mp4a.40.2"')) {
                        targetMime = 'audio/mp4; codecs="mp4a.40.2"';
                    } else if (MediaSource.isTypeSupported('audio/mpeg')) {
                        targetMime = 'audio/mpeg';
                    }
                }

                // Try to set duration from metadata if available
                try {
                    if (message.media instanceof Api.MessageMediaDocument &&
                        message.media.document instanceof Api.Document) {
                        for (const attr of message.media.document.attributes) {
                            if (attr instanceof Api.DocumentAttributeAudio && attr.duration) {
                                this.mediaSource.duration = attr.duration;
                                break;
                            }
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
        message: Api.Message,
        onProgress?: (progress: number) => void
    ) {
        if (!message.media || !(message.media instanceof Api.MessageMediaDocument)) {
            throw new Error('Invalid media');
        }

        const document = message.media.document;
        if (!(document instanceof Api.Document)) {
            throw new Error('Invalid document');
        }

        const fileSize = Number(document.size);
        console.log('Starting streaming download, file size:', fileSize);

        let totalDownloaded = 0;

        try {
            // Use iterDownload to fetch chunks progressively
            // Requesting 128KB chunks usually provides a good balance for streaming
            const chunkSize = 128 * 1024;

            for await (const chunk of client.iterDownload({
                file: message.media,
                chunkSize: chunkSize,
                requestSize: chunkSize,
            })) {
                if (this.isAborted) {
                    throw new Error('DOWNLOAD_ABORTED');
                }

                if (!chunk || chunk.length === 0) continue;

                // Convert buffer to Uint8Array
                let data: Uint8Array;
                if (chunk instanceof Buffer) {
                    data = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
                } else if (chunk instanceof Uint8Array) {
                    data = chunk;
                } else {
                    data = new Uint8Array(chunk as any);
                }

                this.chunks.push(data);
                this.processQueue();

                totalDownloaded += data.length;

                if (onProgress) {
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
                // Cast to any to avoid TypeScript ArrayBufferLike error
                this.sourceBuffer.appendBuffer(chunk as any);
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
            // Check again later
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
