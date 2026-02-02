import { TelegramClient } from '@mtcute/web';
import type { Track, AudioSource } from '../types';

const API_ID = parseInt(import.meta.env.VITE_API_ID || '0');
const API_HASH = import.meta.env.VITE_API_HASH || '';
const STORAGE_KEY = 'music_tg_session';

let client: TelegramClient | null = null;

// Auth state type for managing authentication flow
export type AuthState =
    | { step: 'idle' }
    | { step: 'phone' }
    | { step: 'code'; phoneCodeHash: string; phone: string }
    | { step: '2fa'; hint?: string }
    | { step: 'qr'; url: string }
    | { step: 'done' }
    | { step: 'error'; message: string };

export interface AuthCallbacks {
    onStateChange: (state: AuthState) => void;
}

/**
 * Initialize or get the Telegram client singleton
 */
export const initTelegramClient = (): TelegramClient => {
    if (client) {
        return client;
    }

    client = new TelegramClient({
        apiId: API_ID,
        apiHash: API_HASH,
        storage: STORAGE_KEY, // Uses IndexedDB automatically
        initConnectionOptions: {
            deviceModel: 'Music TG Web',
            appVersion: '1.0.0',
            systemVersion: navigator.userAgent,
        },
    });

    return client;
};

export const getTelegramClient = (): TelegramClient => {
    if (!client) {
        return initTelegramClient();
    }
    return client;
};

/**
 * Check if user is authenticated
 */
export const isAuthenticated = async (): Promise<boolean> => {
    try {
        const tg = getTelegramClient();
        await tg.connect();
        const user = await tg.getMe();
        return !!user;
    } catch {
        return false;
    }
};

/**
 * Start phone-based authentication flow
 */
export async function startPhoneAuth(
    phone: string,
    callbacks: AuthCallbacks
): Promise<void> {
    const tg = getTelegramClient();

    try {
        await tg.connect();
        const result = await tg.sendCode({ phone });

        // sendCode returns SentCode with phoneCodeHash
        if ('phoneCodeHash' in result) {
            callbacks.onStateChange({
                step: 'code',
                phoneCodeHash: result.phoneCodeHash,
                phone,
            });
        } else {
            // Already authenticated
            callbacks.onStateChange({ step: 'done' });
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to send code';
        callbacks.onStateChange({ step: 'error', message });
    }
}

/**
 * Submit the verification code
 */
export async function submitCode(
    phone: string,
    code: string,
    phoneCodeHash: string,
    callbacks: AuthCallbacks
): Promise<void> {
    const tg = getTelegramClient();

    try {
        await tg.signIn({
            phone,
            phoneCode: code,
            phoneCodeHash,
        });

        callbacks.onStateChange({ step: 'done' });
    } catch (error: unknown) {
        // Check if 2FA is required
        if (error instanceof Error && error.message.includes('SESSION_PASSWORD_NEEDED')) {
            try {
                const passwordInfo = await tg.call({ _: 'account.getPassword' });
                callbacks.onStateChange({
                    step: '2fa',
                    hint: passwordInfo.hint ?? undefined,
                });
                return;
            } catch {
                callbacks.onStateChange({
                    step: '2fa',
                    hint: undefined,
                });
                return;
            }
        }

        if (error instanceof Error && error.message.includes('PHONE_CODE_INVALID')) {
            callbacks.onStateChange({ step: 'error', message: 'Invalid verification code' });
            return;
        }

        if (error instanceof Error && error.message.includes('PHONE_NUMBER_UNOCCUPIED')) {
            callbacks.onStateChange({
                step: 'error',
                message: 'Account not found. Please use an existing Telegram account.',
            });
            return;
        }

        const message = error instanceof Error ? error.message : 'Invalid code';
        callbacks.onStateChange({ step: 'error', message });
    }
}

/**
 * Submit 2FA password
 */
export async function submit2FA(
    password: string,
    callbacks: AuthCallbacks
): Promise<void> {
    const tg = getTelegramClient();

    try {
        await tg.checkPassword(password);
        callbacks.onStateChange({ step: 'done' });
    } catch (error: unknown) {
        if (error instanceof Error && error.message.includes('PASSWORD_HASH_INVALID')) {
            callbacks.onStateChange({ step: 'error', message: 'Incorrect password' });
            return;
        }
        const message = error instanceof Error ? error.message : 'Invalid password';
        callbacks.onStateChange({ step: 'error', message });
    }
}

// Store for cancelling active QR polling
let cancelQRPolling: (() => void) | null = null;

/**
 * Stop any active QR polling
 */
export function stopQRAuth(): void {
    if (cancelQRPolling) {
        cancelQRPolling();
        cancelQRPolling = null;
    }
}

/**
 * Start QR code authentication
 */
export async function startQRAuth(callbacks: AuthCallbacks): Promise<void> {
    stopQRAuth();

    const tg = getTelegramClient();

    try {
        await tg.connect();

        const result = await tg.call({
            _: 'auth.exportLoginToken',
            apiId: API_ID,
            apiHash: API_HASH,
            exceptIds: [],
        });

        if (result._ === 'auth.loginToken') {
            // Convert token to base64url for QR code
            const tokenBytes = result.token;
            const tokenBase64 = btoa(String.fromCharCode(...tokenBytes))
                .replace(/\+/g, '-')
                .replace(/\//g, '_')
                .replace(/=+$/, '');
            const url = `tg://login?token=${tokenBase64}`;

            callbacks.onStateChange({ step: 'qr', url });

            // Poll for login completion
            pollQRLogin(result.expires, callbacks);
        }
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'QR login failed';
        callbacks.onStateChange({ step: 'error', message });
    }
}

function pollQRLogin(expires: number, callbacks: AuthCallbacks): void {
    const tg = getTelegramClient();
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    cancelQRPolling = () => {
        cancelled = true;
        if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
        }
    };

    const poll = async () => {
        if (cancelled) return;

        if (Date.now() / 1000 > expires) {
            if (!cancelled) {
                startQRAuth(callbacks);
            }
            return;
        }

        try {
            const result = await tg.call({
                _: 'auth.exportLoginToken',
                apiId: API_ID,
                apiHash: API_HASH,
                exceptIds: [],
            });

            if (cancelled) return;

            if (result._ === 'auth.loginTokenSuccess') {
                cancelQRPolling = null;
                callbacks.onStateChange({ step: 'done' });
                return;
            }

            if (!cancelled) {
                timeoutId = setTimeout(poll, 2000);
            }
        } catch (error: unknown) {
            if (cancelled) return;

            // Check for 2FA requirement
            if (error instanceof Error && error.message.includes('SESSION_PASSWORD_NEEDED')) {
                cancelQRPolling = null;
                try {
                    const passwordInfo = await tg.call({ _: 'account.getPassword' });
                    callbacks.onStateChange({
                        step: '2fa',
                        hint: passwordInfo.hint ?? undefined,
                    });
                } catch {
                    callbacks.onStateChange({
                        step: '2fa',
                        hint: undefined,
                    });
                }
                return;
            }

            if (!cancelled) {
                timeoutId = setTimeout(poll, 2000);
            }
        }
    };

    poll();
}

/**
 * Logout and clear session
 */
export async function logout(): Promise<void> {
    if (client) {
        try {
            await client.logOut();
        } catch (error) {
            console.warn('Error during logout:', error);
        }
        client = null;
    }
}

/**
 * Fetch audio files from saved messages or a specific chat
 */
export const fetchAudioFiles = async (
    chatId?: string,
    onTrackFound?: (track: Track) => void
): Promise<Track[]> => {
    const tg = getTelegramClient();
    console.log('fetchAudioFiles: Starting...');
    const tracks: Track[] = [];

    try {
        await tg.connect();
        const me = await tg.getMe();
        console.log('fetchAudioFiles: Current user ID:', me.id.toString());

        // Get target peer (Saved Messages or specific chat)
        const targetId = chatId || me.id.toString();
        let targetPeer: Parameters<typeof tg.getMessages>[0];

        if (chatId) {
            // Try to resolve the chat ID by iterating dialogs
            let targetDialog = null;
            for await (const dialog of tg.iterDialogs()) {
                if (dialog.peer.id.toString() === chatId) {
                    targetDialog = dialog;
                    break;
                }
            }
            if (targetDialog) {
                targetPeer = targetDialog.peer.inputPeer;
            } else {
                throw new Error('Chat not found');
            }
        } else {
            // Use "me" for Saved Messages
            targetPeer = 'me';
        }

        console.log('fetchAudioFiles: Fetching messages...');

        // Fetch messages - mtcute uses async iterators
        let messageCount = 0;
        const MAX_MESSAGES_SCAN = 500;

        for await (const message of tg.iterHistory(targetPeer, { limit: MAX_MESSAGES_SCAN })) {
            messageCount++;

            if (message.media?.type === 'document') {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const doc = message.media as any;
                const mimeType = doc.mimeType;

                // Check if it's an audio file
                if (mimeType?.startsWith('audio/')) {
                    let title = 'Unknown Track';
                    let artist = 'Unknown Artist';
                    let duration = 0;

                    // Extract audio metadata
                    if (doc.type === 'audio' || doc.attributes) {
                        title = doc.title || doc.fileName || title;
                        artist = doc.performer || artist;
                        duration = doc.duration || 0;
                    } else if (doc.fileName) {
                        title = doc.fileName.replace(/\.(mp3|ogg|m4a|flac)$/i, '');
                    }

                    const track: Track = {
                        id: `${message.id}`,
                        title,
                        artist,
                        duration,
                        fileSize: doc.fileSize || 0,
                        messageId: message.id,
                        mimeType: mimeType || 'audio/mpeg',
                        chatId: targetId,
                    };

                    tracks.push(track);

                    if (onTrackFound) {
                        onTrackFound(track);
                    }
                }
            }
        }

        console.log('fetchAudioFiles: Finished! Found', tracks.length, 'audio files from', messageCount, 'messages');
        return tracks;
    } catch (error) {
        console.error('fetchAudioFiles: Error occurred:', error);
        throw error;
    }
};

/**
 * Download an audio file as a Blob
 */
export const downloadAudioFile = async (
    messageId: number,
    chatId?: string,
    onProgress?: (progress: number) => void
): Promise<Blob> => {
    const tg = getTelegramClient();

    try {
        console.log('downloadAudioFile: Starting download for message ID:', messageId);

        await tg.connect();

        let targetPeer: Parameters<typeof tg.getMessages>[0];

        if (chatId) {
            let targetDialog = null;
            for await (const dialog of tg.iterDialogs()) {
                if (dialog.peer.id.toString() === chatId) {
                    targetDialog = dialog;
                    break;
                }
            }
            if (targetDialog) {
                targetPeer = targetDialog.peer.inputPeer;
            } else {
                throw new Error('Chat not found');
            }
        } else {
            targetPeer = 'me';
        }

        // Get the message
        const messages = await tg.getMessages(targetPeer, [messageId]);
        const message = messages[0];

        if (!message) {
            throw new Error('Message not found');
        }

        if (!message.media || message.media.type !== 'document') {
            throw new Error('Message has no audio');
        }

        console.log('downloadAudioFile: Downloading media...');

        // Download as buffer
        const buffer = await tg.downloadAsBuffer(message.media, {
            progressCallback: (downloaded: number, total: number) => {
                if (onProgress && total > 0) {
                    onProgress((downloaded / total) * 100);
                }
            }
        });

        console.log('downloadAudioFile: Creating blob...');
        const blob = new Blob([buffer as unknown as BlobPart], { type: message.media.mimeType || 'audio/mpeg' });
        console.log('downloadAudioFile: Success! Blob size:', blob.size);
        return blob;
    } catch (error) {
        console.error('downloadAudioFile error:', error);
        throw error;
    }
};

/**
 * Get available audio sources (chats/channels)
 */
export const getAudioSources = async (): Promise<AudioSource[]> => {
    const tg = getTelegramClient();

    try {
        await tg.connect();
        const sources: AudioSource[] = [];

        for await (const dialog of tg.iterDialogs()) {
            const peer = dialog.peer;
            let type: 'user' | 'chat' | 'channel' = 'chat';

            if (peer.type === 'user') {
                type = 'user';
            } else if (peer.type === 'chat') {
                // peer is Chat, check chatType
                const chatType = (peer as any).chatType;
                if (chatType === 'channel') {
                    type = 'channel';
                } else {
                    type = 'chat';
                }
            }

            sources.push({
                id: peer.id.toString(),
                title: peer.displayName || 'Unknown',
                type: type,
            });
        }

        return sources;
    } catch (error) {
        console.error('getAudioSources error:', error);
        throw error;
    }
};

/**
 * Download audio file with streaming support
 */
export const downloadAudioFileStreaming = async (
    messageId: number,
    mimeType: string,
    chatId?: string,
    onProgress?: (progress: number) => void
): Promise<{ url: string; cleanup: () => void }> => {
    const tg = getTelegramClient();

    try {
        console.log('downloadAudioFileStreaming: Starting for message ID:', messageId);

        await tg.connect();

        let targetPeer: Parameters<typeof tg.getMessages>[0];

        if (chatId) {
            let targetDialog = null;
            for await (const dialog of tg.iterDialogs()) {
                if (dialog.peer.id.toString() === chatId) {
                    targetDialog = dialog;
                    break;
                }
            }
            if (targetDialog) {
                targetPeer = targetDialog.peer.inputPeer;
            } else {
                throw new Error('Chat not found');
            }
        } else {
            targetPeer = 'me';
        }

        const messages = await tg.getMessages(targetPeer, [messageId]);
        const message = messages[0];

        if (!message || !message.media || message.media.type !== 'document') {
            throw new Error('Media not found');
        }

        // Use streaming downloader
        const { StreamingAudioDownloader } = await import('./streamingDownload');
        const downloader = new StreamingAudioDownloader();

        const url = await downloader.startStreaming(tg, message, mimeType, onProgress);

        return {
            url,
            cleanup: () => {
                downloader.cleanup();
                URL.revokeObjectURL(url);
            }
        };
    } catch (error) {
        console.error('downloadAudioFileStreaming error:', error);
        throw error;
    }
};

// Session management - mtcute uses IndexedDB automatically
// These functions are for compatibility but session is handled internally

export const saveSession = (_session: string) => {
    // mtcute manages session in IndexedDB automatically
    console.log('Session saved automatically by mtcute');
};

export const loadSession = (): string | null => {
    // Return a placeholder - actual check is via isAuthenticated()
    return localStorage.getItem('mtcute_initialized');
};

export const clearSession = async () => {
    await logout();
    localStorage.removeItem('mtcute_initialized');
};