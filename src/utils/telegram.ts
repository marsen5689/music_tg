import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions';
import { Api } from 'telegram/tl';
import type { Track, AudioSource } from '../types';

const API_ID = parseInt(import.meta.env.VITE_API_ID || '0');
const API_HASH = import.meta.env.VITE_API_HASH || '';

let client: TelegramClient | null = null;

export const initTelegramClient = (session: string = '') => {
    const stringSession = new StringSession(session);
    client = new TelegramClient(stringSession, API_ID, API_HASH, {
        connectionRetries: 5,
    });
    return client;
};

export const getTelegramClient = () => {
    if (!client) {
        throw new Error('Telegram client not initialized');
    }
    return client;
};

export const connectWithQR = async (
    onQRCode: (qrCode: { token: Buffer; expires: number }) => void,
    onPasswordRequired?: (hint?: string) => Promise<string>
): Promise<string> => {
    if (!client) {
        throw new Error('Client not initialized');
    }

    await client.connect();

    let passwordCache: string | null = null;

    const user = await client.signInUserWithQrCode(
        { apiId: API_ID, apiHash: API_HASH },
        {
            qrCode: async (code) => {
                onQRCode(code);
            },
            password: async (hint) => {
                if (!passwordCache && onPasswordRequired) {
                    passwordCache = await onPasswordRequired(hint);
                    console.log('Password cached, type:', typeof passwordCache, 'length:', passwordCache?.length);
                }
                return Buffer.from(passwordCache || '', 'utf-8') as any;
            },
            onError: async (err) => {
                console.error('QR Auth error:', err);
                throw err;
            },
        }
    );

    console.log('Logged in as:', user);
    const stringSession = client.session as StringSession;
    return String(stringSession.save());
};

export const connectWithPhone = async (
    phoneNumber: string,
    onCodeRequired: () => Promise<string>,
    onPasswordRequired?: (hint?: string) => Promise<string>
): Promise<string> => {
    if (!client) {
        throw new Error('Client not initialized');
    }

    await client.connect();

    await client.sendCode(
        {
            apiId: API_ID,
            apiHash: API_HASH,
        },
        phoneNumber
    );

    const code = await onCodeRequired();

    let passwordCache: string | null = null;

    await client.signInUser(
        {
            apiId: API_ID,
            apiHash: API_HASH,
        },
        {
            phoneNumber,
            phoneCode: async () => code,
            password: async (hint) => {
                if (!passwordCache && onPasswordRequired) {
                    passwordCache = await onPasswordRequired(hint);
                    console.log('Password cached, type:', typeof passwordCache, 'length:', passwordCache?.length);
                }
                return Buffer.from(passwordCache || '', 'utf-8') as any;
            },
            onError: async (err) => {
                console.error('Phone Auth error:', err);
                throw err;
            },
        }
    );

    const stringSession = client.session as StringSession;
    return String(stringSession.save());
};

export const getAudioSources = async (): Promise<AudioSource[]> => {
    if (!client) {
        throw new Error('Client not initialized');
    }

    try {
        const dialogs = await client.getDialogs({ limit: 100 });
        const me = await client.getMe();
        const meId = me.id.toString();

        return dialogs
            .filter((d) => d.entity && 'id' in d.entity)
            .map((d) => {
                const entity = d.entity as any;
                const id = entity.id.toString();
                let title = d.title || 'Untitled';

                // Rename self-chat to "Saved Messages"
                if (id === meId) {
                    title = 'Saved Messages';
                }

                let type: AudioSource['type'] = 'chat';
                if (d.isUser) type = 'user';
                if (d.isChannel) type = 'channel';

                return {
                    id,
                    title,
                    type,
                };
            });
    } catch (error) {
        console.error('getAudioSources: Error', error);
        return [];
    }
};

export const fetchAudioFiles = async (
    chatId?: string,
    onTrackFound?: (track: Track) => void
): Promise<Track[]> => {
    if (!client) {
        throw new Error('Client not initialized');
    }

    console.log('fetchAudioFiles: Starting...');
    const tracks: Track[] = [];

    try {
        // Get "Saved Messages" chat
        console.log('fetchAudioFiles: Getting dialogs...');
        const dialogs = await client.getDialogs({ limit: 100 });
        console.log('fetchAudioFiles: Got', dialogs.length, 'dialogs');

        const me = await client.getMe();
        console.log('fetchAudioFiles: Current user ID:', me.id.toString());

        // Find target dialog (Saved Messages or specific chat)
        const targetId = chatId || me.id.toString();

        const targetDialog = dialogs.find((dialog) => {
            if (!dialog.entity || !('id' in dialog.entity)) return false;
            // Compare as strings to handle BigInt properly
            return dialog.entity.id.toString() === targetId;
        });

        if (!targetDialog || !targetDialog.entity) {
            console.error('fetchAudioFiles: Target dialog not found', targetId);
            console.error('Available dialogs:', dialogs.map(d => ({
                title: d.title,
                isUser: d.isUser,
                id: d.entity && 'id' in d.entity ? d.entity.id.toString() : 'no id'
            })));
            throw new Error('Chat not found.');
        }

        console.log('fetchAudioFiles: Found chat!', targetDialog.title);

        // Fetch messages with audio
        let offsetId = 0;
        let hasMore = true;
        let messageCount = 0;
        // Limit total messages to scan to avoid infinite loading if no music
        const MAX_MESSAGES_SCAN = 500;

        while (hasMore && messageCount < MAX_MESSAGES_SCAN) {
            console.log('fetchAudioFiles: Fetching batch with offsetId:', offsetId);
            const messages = await client.getMessages(targetDialog.entity, {
                limit: 100,
                offsetId,
            });

            messageCount += messages.length;
            console.log('fetchAudioFiles: Got', messages.length, 'messages (total:', messageCount, ')');

            if (messages.length === 0) {
                hasMore = false;
                break;
            }

            for (const message of messages) {
                if (message.media && message.media instanceof Api.MessageMediaDocument) {
                    const document = message.media.document;

                    if (document instanceof Api.Document) {
                        const mimeType = document.mimeType;

                        // Check if it's an audio file
                        if (mimeType?.startsWith('audio/')) {
                            let title = 'Unknown Track';
                            let artist = 'Unknown Artist';
                            let duration = 0;

                            // Extract metadata from attributes
                            for (const attr of document.attributes) {
                                if (attr instanceof Api.DocumentAttributeAudio) {
                                    title = attr.title || title;
                                    artist = attr.performer || artist;
                                    duration = attr.duration || 0;
                                } else if (attr instanceof Api.DocumentAttributeFilename) {
                                    // Fallback to filename if no title
                                    if (title === 'Unknown Track') {
                                        title = attr.fileName.replace(/\.(mp3|ogg|m4a|flac)$/i, '');
                                    }
                                }
                            }

                            const track: Track = {
                                id: `${message.id}`,
                                title,
                                artist,
                                duration,
                                fileSize: Number(document.size),
                                messageId: message.id,
                                mimeType: mimeType || 'audio/mpeg',
                                chatId: chatId || me.id.toString(),
                            };

                            tracks.push(track);

                            if (onTrackFound) {
                                onTrackFound(track);
                            }
                        }
                    }
                }
            }

            offsetId = messages[messages.length - 1].id;
        }

        console.log('fetchAudioFiles: Finished! Found', tracks.length, 'audio files');
        return tracks;
    } catch (error) {
        console.error('fetchAudioFiles: Error occurred:', error);
        throw error;
    }
};

export const downloadAudioFile = async (
    messageId: number,
    chatId?: string,
    onProgress?: (progress: number) => void
): Promise<Blob> => {
    if (!client) {
        throw new Error('Client not initialized');
    }

    try {
        console.log('downloadAudioFile: Starting download for message ID:', messageId, 'chatId:', chatId);

        const dialogs = await client.getDialogs({ limit: 100 });
        const me = await client.getMe();
        const targetId = chatId || me.id.toString();

        // Use same logic as fetchAudioFiles
        const targetDialog = dialogs.find((dialog) => {
            if (!dialog.entity || !('id' in dialog.entity)) return false;
            return dialog.entity.id.toString() === targetId;
        });

        if (!targetDialog || !targetDialog.entity) {
            console.error('downloadAudioFile: Chat not found');
            throw new Error('Chat not found');
        }

        console.log('downloadAudioFile: Getting message...');
        const messages = await client.getMessages(targetDialog.entity, {
            ids: [messageId],
        });

        const message = messages[0];

        if (!message) {
            console.error('downloadAudioFile: Message not found');
            throw new Error('Message not found');
        }

        if (!message.media) {
            console.error('downloadAudioFile: Message has no media');
            throw new Error('Message has no media');
        }

        console.log('downloadAudioFile: Downloading media...');
        const buffer = await client.downloadMedia(message, {
            progressCallback: (downloaded, total) => {
                if (onProgress && total) {
                    const progress = (Number(downloaded) / Number(total)) * 100;
                    onProgress(progress);
                }
            },
        });

        if (!buffer) {
            console.error('downloadAudioFile: Failed to download media');
            throw new Error('Failed to download media');
        }

        console.log('downloadAudioFile: Creating blob...');
        // Convert to Blob - Blob constructor accepts Buffer, Uint8Array, ArrayBuffer
        const blob = new Blob([buffer as any], { type: 'audio/mpeg' });
        console.log('downloadAudioFile: Success! Blob size:', blob.size);
        return blob;
    } catch (error) {
        console.error('downloadAudioFile: Error occurred:', error);
        throw error;
    }
};

export const downloadAudioFileStreaming = async (
    messageId: number,
    mimeType: string,
    chatId?: string,
    onProgress?: (progress: number) => void
): Promise<{ url: string; cleanup: () => void }> => {
    if (!client) {
        throw new Error('Client not initialized');
    }

    try {
        console.log('downloadAudioFileStreaming: Starting streaming download for message ID:', messageId, 'type:', mimeType);

        const dialogs = await client.getDialogs({ limit: 100 });
        const me = await client.getMe();
        const targetId = chatId || me.id.toString();

        const targetDialog = dialogs.find((dialog) => {
            if (!dialog.entity || !('id' in dialog.entity)) return false;
            return dialog.entity.id.toString() === targetId;
        });

        if (!targetDialog || !targetDialog.entity) {
            console.error('downloadAudioFileStreaming: Chat not found');
            throw new Error('Chat not found');
        }

        console.log('downloadAudioFileStreaming: Getting message...');
        const messages = await client.getMessages(targetDialog.entity, {
            ids: [messageId],
        });

        const message = messages[0];

        if (!message) {
            console.error('downloadAudioFileStreaming: Message not found');
            throw new Error('Message not found');
        }

        if (!message.media) {
            console.error('downloadAudioFileStreaming: Message has no media');
            throw new Error('Message has no media');
        }

        // Import dynamically to avoid circular dependencies
        const { StreamingAudioDownloader } = await import('./streamingDownload');
        const downloader = new StreamingAudioDownloader();

        console.log('downloadAudioFileStreaming: Starting stream...');
        const url = await downloader.startStreaming(client, message, mimeType, onProgress);

        console.log('downloadAudioFileStreaming: Stream URL created:', url);

        return {
            url,
            cleanup: () => {
                downloader.cleanup();
                URL.revokeObjectURL(url);
            }
        };
    } catch (error) {
        console.error('downloadAudioFileStreaming: Error occurred:', error);
        throw error;
    }
};


export const saveSession = (session: string) => {
    localStorage.setItem('telegram_session', session);
};

export const loadSession = (): string | null => {
    return localStorage.getItem('telegram_session');
};

export const clearSession = () => {
    localStorage.removeItem('telegram_session');
};
