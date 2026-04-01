import React, { useEffect, useRef, useState } from 'react';
import type { AudioSource, Track } from '../types';
import {
    clearSession,
    downloadAudioFile,
    downloadAudioFileStreaming,
    fetchAudioFiles,
    getAudioSources,
    getTelegramClient,
} from '../utils/telegram';
import {
    AlertCircle,
    Disc,
    Loader2,
    LogOut,
    Megaphone,
    Music,
    Pause,
    Play,
    Search,
    Settings,
    SkipBack,
    SkipForward,
    Sparkles,
    Star,
    User,
    Users,
    Volume2,
    Waves,
    X,
} from 'lucide-react';
import './Player.css';

interface PlayerProps {
    onLogout: () => void;
}

const Player: React.FC<PlayerProps> = ({ onLogout }) => {
    const [tracks, setTracks] = useState<Track[]>([]);
    const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
    const [pendingTrack, setPendingTrack] = useState<Track | null>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.7);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingProgress, setLoadingProgress] = useState(0);
    const [currentSourceId, setCurrentSourceId] = useState<string | undefined>(undefined);
    const [audioSources, setAudioSources] = useState<AudioSource[]>([]);
    const [showSettings, setShowSettings] = useState(false);
    const [sourceSearchQuery, setSourceSearchQuery] = useState('');
    const [noTracksFound, setNoTracksFound] = useState(false);
    const [isBuffering, setIsBuffering] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const progressBarRef = useRef<HTMLDivElement>(null);
    const volumeBarRef = useRef<HTMLDivElement>(null);
    const volumeDragCleanupRef = useRef<(() => void) | null>(null);
    const trackCacheRef = useRef<Map<string, string>>(new Map());
    const cleanupRef = useRef<(() => void) | null>(null);
    const nextTrackTriggerRef = useRef<(() => void) | null>(null);
    const loadingTrackIdRef = useRef<string | null>(null);

    const filteredSources = audioSources.filter((source) =>
        source.title.toLowerCase().includes(sourceSearchQuery.toLowerCase())
    );

    const filteredTracks = tracks.filter((track) =>
        track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        track.artist.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const uniqueArtists = new Set(tracks.map((track) => track.artist)).size;
    const totalDurationMinutes = Math.round(
        tracks.reduce((sum, track) => sum + (track.duration || 0), 0) / 60
    );
    const activeSource =
        audioSources.find((source) => source.id === currentSourceId)?.title ||
        (currentSourceId ? 'Selected source' : 'Saved Messages');

    const loadTracks = async () => {
        setIsLoading(true);
        setTracks([]);
        setNoTracksFound(false);

        const timeoutId = setTimeout(() => {
            setTracks((currentTracks) => {
                if (currentTracks.length === 0) {
                    setNoTracksFound(true);
                }
                return currentTracks;
            });
        }, 3000);

        try {
            const client = getTelegramClient();
            await client.connect();

            const audioFiles = await fetchAudioFiles(currentSourceId, (track) => {
                setTracks((prev) => {
                    const exists = prev.some((item) => item.id === track.id);
                    if (exists) return prev;
                    if (prev.length === 0) {
                        setNoTracksFound(false);
                        clearTimeout(timeoutId);
                    }
                    return [...prev, track];
                });
            });

            setTracks(audioFiles);
        } catch (error) {
            console.error('Failed to load tracks:', error);
            setTracks((current) => {
                if (current.length === 0) {
                    alert(`Failed to load tracks: ${error instanceof Error ? error.message : 'Unknown error'}. Please check the console for details.`);
                }
                return current;
            });
        } finally {
            clearTimeout(timeoutId);
            setIsLoading(false);
        }
    };

    useEffect(() => {
        loadTracks();
    }, [currentSourceId]);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
        }
    }, [volume]);

    const playTrack = async (track: Track) => {
        if (currentTrack?.id === track.id && audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
                setIsPlaying(false);
            } else {
                await audioRef.current.play();
                setIsPlaying(true);
            }
            return;
        }

        setPendingTrack(track);
        setIsBuffering(true);
        loadingTrackIdRef.current = track.id;
        setLoadingProgress(0);

        try {
            let url: string;
            let cleanup: (() => void) | undefined;

            if (trackCacheRef.current.has(track.id)) {
                url = trackCacheRef.current.get(track.id)!;
            } else {
                try {
                    const result = await downloadAudioFileStreaming(
                        track.messageId,
                        track.mimeType,
                        track.chatId,
                        (progress) => {
                            if (loadingTrackIdRef.current === track.id) {
                                setLoadingProgress(progress);
                            }
                        }
                    );
                    url = result.url;
                    cleanup = result.cleanup;
                } catch (streamError) {
                    if (loadingTrackIdRef.current !== track.id) return;
                    console.warn('Streaming failed, falling back to regular download:', streamError);
                    const blob = await downloadAudioFile(track.messageId, track.chatId, (progress) => {
                        if (loadingTrackIdRef.current === track.id) {
                            setLoadingProgress(progress);
                        }
                    });
                    url = URL.createObjectURL(blob);
                }

                if (loadingTrackIdRef.current !== track.id) {
                    if (cleanup) cleanup();
                    return;
                }

                if (!cleanup) {
                    trackCacheRef.current.set(track.id, url);
                }
            }

            if (cleanupRef.current) {
                cleanupRef.current();
                cleanupRef.current = null;
            }
            if (cleanup) {
                cleanupRef.current = cleanup;
            }

            const nextAudio = new Audio(url);
            nextAudio.volume = volume;
            nextAudio.preload = 'auto';

            setCurrentTrack(track);
            setPendingTrack(track);
            setIsPlaying(false);
            setCurrentTime(0);
            setDuration(track.duration || 0);

            nextAudio.onloadedmetadata = () => {
                if (loadingTrackIdRef.current !== track.id) return;
                setDuration(nextAudio.duration || track.duration || 0);
            };

            nextAudio.oncanplay = async () => {
                if (loadingTrackIdRef.current !== track.id) return;

                if (audioRef.current) {
                    audioRef.current.pause();
                    audioRef.current.src = '';
                    audioRef.current.ontimeupdate = null;
                    audioRef.current.onended = null;
                }

                audioRef.current = nextAudio;

                nextAudio.ontimeupdate = () => {
                    setCurrentTime(nextAudio.currentTime);
                };

                nextAudio.onended = () => {
                    nextTrackTriggerRef.current?.();
                };

                setPendingTrack(null);
                setIsBuffering(false);
                setDuration(nextAudio.duration || track.duration || 0);

                try {
                    await nextAudio.play();
                    setIsPlaying(true);
                } catch (error) {
                    console.error('Playback failed', error);
                    setIsPlaying(false);
                }
            };

            nextAudio.onplay = () => {
                if (loadingTrackIdRef.current !== track.id) return;
                setPendingTrack(null);
                setIsBuffering(false);
                setIsPlaying(true);
            };

            nextAudio.onwaiting = () => {
                if (loadingTrackIdRef.current !== track.id) return;
                setIsBuffering(true);
            };

            nextAudio.onplaying = () => {
                if (loadingTrackIdRef.current !== track.id) return;
                setIsBuffering(false);
                setIsPlaying(true);
            };

            nextAudio.onerror = (event) => {
                if (loadingTrackIdRef.current !== track.id) return;
                console.error('Error loading new track', event);
                setPendingTrack(null);
                setIsBuffering(false);
                alert('Failed to load track');
            };

            nextAudio.load();
            void nextAudio.play().catch((error) => {
                console.warn('Immediate playback is waiting for buffer or user gesture:', error);
            });
        } catch (error) {
            if (loadingTrackIdRef.current !== track.id) return;
            console.error('Failed to play track:', error);
            setPendingTrack(null);
            setIsBuffering(false);
            alert(`Failed to play track: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };

    const playNext = () => {
        if (!currentTrack) return;
        const currentIndex = tracks.findIndex((track) => track.id === currentTrack.id);
        if (currentIndex < tracks.length - 1) {
            playTrack(tracks[currentIndex + 1]);
        }
    };

    const playPrevious = () => {
        if (!currentTrack) return;
        const currentIndex = tracks.findIndex((track) => track.id === currentTrack.id);
        if (currentIndex > 0) {
            playTrack(tracks[currentIndex - 1]);
        }
    };

    const togglePlayPause = async () => {
        if (!audioRef.current || !currentTrack) return;

        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            await audioRef.current.play();
            setIsPlaying(true);
        }
    };

    useEffect(() => {
        nextTrackTriggerRef.current = playNext;
    }, [currentTrack, tracks]);

    useEffect(() => {
        if (!audioRef.current) {
            audioRef.current = new Audio();
        }

        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            if (cleanupRef.current) {
                cleanupRef.current();
            }
            if (volumeDragCleanupRef.current) {
                volumeDragCleanupRef.current();
            }
        };
    }, []);

    const handleProgressClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!audioRef.current || !progressBarRef.current) return;

        const rect = progressBarRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const percentage = x / rect.width;
        const newTime = percentage * duration;

        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
    };

    const handleVolumeClick = (event: React.MouseEvent<HTMLDivElement>) => {
        if (!volumeBarRef.current) return;

        const rect = volumeBarRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const percentage = Math.max(0, Math.min(1, x / rect.width));

        setVolume(percentage);
    };

    const updateVolumeFromPointer = (clientX: number) => {
        if (!volumeBarRef.current) return;

        const rect = volumeBarRef.current.getBoundingClientRect();
        const percentage = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        setVolume(percentage);
    };

    const handleVolumePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        updateVolumeFromPointer(event.clientX);

        const handlePointerMove = (moveEvent: PointerEvent) => {
            updateVolumeFromPointer(moveEvent.clientX);
        };

        const cleanup = () => {
            window.removeEventListener('pointermove', handlePointerMove);
            window.removeEventListener('pointerup', cleanup);
            window.removeEventListener('pointercancel', cleanup);
            volumeDragCleanupRef.current = null;
        };

        volumeDragCleanupRef.current?.();
        volumeDragCleanupRef.current = cleanup;

        window.addEventListener('pointermove', handlePointerMove);
        window.addEventListener('pointerup', cleanup);
        window.addEventListener('pointercancel', cleanup);
    };

    const formatTime = (seconds: number): string => {
        if (Number.isNaN(seconds)) return '0:00';

        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleLogout = () => {
        if (audioRef.current) {
            audioRef.current.pause();
        }

        if (cleanupRef.current) {
            cleanupRef.current();
            cleanupRef.current = null;
        }

        trackCacheRef.current.forEach((url) => {
            URL.revokeObjectURL(url);
        });
        trackCacheRef.current.clear();

        clearSession();
        onLogout();
    };

    const handleOpenSettings = async () => {
        setShowSettings(true);
        const sources = await getAudioSources();
        setAudioSources(sources);
    };

    const handleSourceSelect = (sourceId: string) => {
        setCurrentSourceId(sourceId);
        setShowSettings(false);
    };

    const progressPercentage = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="player-page fade-in">
            <div className="player-page__glow player-page__glow--one" />
            <div className="player-page__glow player-page__glow--two" />

            <header className="player-topbar">
                <div className="brand-lockup">
                    <div className="brand-mark">
                        <Music size={24} />
                    </div>
                    <div>
                        <p className="eyebrow">Telegram Music Archive</p>
                        <h1>Music TG</h1>
                    </div>
                </div>

                <div className="topbar-actions">
                    <button className="topbar-button" onClick={handleOpenSettings} title="Settings">
                        <Settings size={18} />
                        <span>Sources</span>
                    </button>
                    <button className="topbar-button topbar-button--danger" onClick={handleLogout}>
                        <LogOut size={16} />
                        <span>Logout</span>
                    </button>
                </div>
            </header>

            <main className="player-layout">
                <aside className="player-sidebar">
                    <section className="hero-panel">
                        <div className="hero-panel__badge">
                            <Sparkles size={14} />
                            <span>Curated listening cockpit</span>
                        </div>
                        <h2>Your Telegram music, reframed like a premium collection.</h2>
                        <p>
                            Browse saved audio, switch between sources, and keep playback controls close without losing the library overview.
                        </p>

                        <div className="hero-stats">
                            <div className="hero-stat">
                                <span className="hero-stat__label">Tracks</span>
                                <strong>{tracks.length}</strong>
                            </div>
                            <div className="hero-stat">
                                <span className="hero-stat__label">Artists</span>
                                <strong>{uniqueArtists}</strong>
                            </div>
                            <div className="hero-stat">
                                <span className="hero-stat__label">Minutes</span>
                                <strong>{totalDurationMinutes}</strong>
                            </div>
                        </div>
                    </section>

                    <section className="sidebar-card sidebar-source-card">
                        <div className="sidebar-card__header">
                            <span className="sidebar-card__kicker">Active source</span>
                            <Waves size={16} />
                        </div>
                        <strong>{activeSource}</strong>
                        <p>{currentSourceId ? 'Library scoped to the selected dialog or channel.' : 'Listening from your Saved Messages archive.'}</p>
                    </section>

                    <section className="sidebar-card spotlight-card">
                        <div className="sidebar-card__header">
                            <span className="sidebar-card__kicker">Now in focus</span>
                            <Disc size={16} />
                        </div>

                        {currentTrack ? (
                            <>
                                <div className="spotlight-card__art">
                                    <Music size={28} />
                                </div>
                                <strong>{currentTrack.title}</strong>
                                <p>{currentTrack.artist}</p>
                                <div className="spotlight-card__meta">
                                    <span>{formatTime(duration || currentTrack.duration)}</span>
                                    <span>{isPlaying ? 'Playing' : 'Paused'}</span>
                                </div>
                            </>
                        ) : (
                            <>
                                <div className="spotlight-card__art spotlight-card__art--idle">
                                    <Play size={22} />
                                </div>
                                <strong>Pick a track to begin</strong>
                                <p>The dock and progress bar will come alive as soon as playback starts.</p>
                            </>
                        )}
                    </section>
                </aside>

                <section className="library-shell">
                    <div className="library-shell__header">
                        <div>
                            <p className="eyebrow">Library</p>
                            <h2>Sound selection</h2>
                        </div>
                        <div className="library-shell__meta">
                            <div className="search-shell">
                                <Search className="search-icon" size={16} />
                                <input
                                    type="text"
                                    className="search-input"
                                    placeholder="Search tracks or artists"
                                    value={searchQuery}
                                    onChange={(event) => setSearchQuery(event.target.value)}
                                />
                            </div>
                            <div className="library-badge">{filteredTracks.length} visible</div>
                        </div>
                    </div>

                    <div className="library-list">
                        {filteredTracks.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-state__icon">
                                    {searchQuery ? <Search size={42} /> : <Disc size={42} />}
                                </div>
                                <strong>{searchQuery ? 'Nothing matches this search' : 'No music found yet'}</strong>
                                <p>{searchQuery ? 'Try a different title, artist, or clear the search field.' : 'This source does not contain any supported audio messages yet.'}</p>
                            </div>
                        ) : (
                            filteredTracks.map((track, index) => {
                                const isCurrent = currentTrack?.id === track.id;
                                const isPending = pendingTrack?.id === track.id;

                                return (
                                    <button
                                        key={track.id}
                                        className={`track-card ${isCurrent ? 'is-active' : ''}`}
                                        onClick={() => playTrack(track)}
                                    >
                                        <div className="track-card__index">
                                            {isPending ? (
                                                <Loader2 className="animate-spin" size={15} />
                                            ) : isCurrent && isPlaying ? (
                                                <Pause size={15} />
                                            ) : (
                                                <span>{String(index + 1).padStart(2, '0')}</span>
                                            )}
                                        </div>

                                        <div className="track-card__art">
                                            <Music size={18} />
                                        </div>

                                        <div className="track-card__content">
                                            <strong>{track.title}</strong>
                                            <span>{track.artist}</span>
                                        </div>

                                        <div className="track-card__tail">
                                            {isCurrent && <span className="track-chip">Live</span>}
                                            <span className="track-card__time">{formatTime(track.duration)}</span>
                                        </div>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </section>
            </main>

            {currentTrack && (
                <section className="dock">
                    <div className="dock__track">
                        <div className="dock__art">
                            <Music size={24} />
                        </div>
                        <div className="dock__copy">
                            <strong>{currentTrack.title}</strong>
                            <span>{currentTrack.artist}</span>
                        </div>
                    </div>

                    <div className="dock__controls">
                        <div className="progress-row">
                            <span>{formatTime(currentTime)}</span>
                            <div
                                ref={progressBarRef}
                                className="progress-bar"
                                onClick={handleProgressClick}
                            >
                                <div
                                    className="progress-bar__fill"
                                    style={{ width: `${progressPercentage}%` }}
                                />
                            </div>
                            <span>{formatTime(duration)}</span>
                        </div>

                        <div className="transport">
                            <button className="transport__button" onClick={playPrevious} disabled={!currentTrack}>
                                <SkipBack size={18} fill="currentColor" />
                            </button>
                            <button className="transport__button transport__button--primary" onClick={togglePlayPause} disabled={!currentTrack}>
                                {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
                            </button>
                            <button className="transport__button" onClick={playNext} disabled={!currentTrack}>
                                <SkipForward size={18} fill="currentColor" />
                            </button>
                        </div>
                    </div>

                    <div className="dock__volume">
                        <Volume2 size={18} />
                        <div
                            ref={volumeBarRef}
                            className="volume-bar"
                            onClick={handleVolumeClick}
                            onPointerDown={handleVolumePointerDown}
                        >
                            <div
                                className="volume-bar__fill"
                                style={{ width: `${volume * 100}%` }}
                            />
                        </div>
                    </div>

                    {isBuffering && (
                        <div className="buffer-line">
                            <div className="buffer-line__fill" style={{ width: `${Math.max(10, loadingProgress)}%` }} />
                        </div>
                    )}
                </section>
            )}

            {isLoading && tracks.length === 0 && !noTracksFound && (
                <div className="loading-overlay">
                    <div className="loading-panel">
                        <Loader2 className="spinner-icon" size={42} />
                        <strong>Scanning your Telegram audio</strong>
                        <p>Collecting tracks and shaping the library view.</p>
                    </div>
                </div>
            )}

            {noTracksFound && tracks.length === 0 && (
                <div className="loading-overlay">
                    <div className="loading-panel">
                        <AlertCircle size={42} />
                        <strong>Nothing found</strong>
                        <p>Try reloading this source or choose another dialog.</p>
                        <button
                            className="topbar-button"
                            onClick={() => {
                                setNoTracksFound(false);
                                loadTracks();
                            }}
                        >
                            Try Again
                        </button>
                    </div>
                </div>
            )}

            {showSettings && (
                <div className="settings-overlay fade-in" onClick={() => setShowSettings(false)}>
                    <div className="settings-modal" onClick={(event) => event.stopPropagation()}>
                        <div className="settings-modal__header">
                            <div>
                                <p className="eyebrow">Sources</p>
                                <h3>Choose a chat or channel</h3>
                            </div>
                            <button className="icon-button" onClick={() => setShowSettings(false)}>
                                <X size={20} />
                            </button>
                        </div>

                        <div className="settings-modal__search">
                            <div className="search-shell">
                                <Search className="search-icon" size={16} />
                                <input
                                    type="text"
                                    className="search-input"
                                    placeholder="Search chats"
                                    value={sourceSearchQuery}
                                    onChange={(event) => setSourceSearchQuery(event.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>

                        <div className="settings-modal__list">
                            {filteredSources.map((source) => (
                                <button
                                    key={source.id}
                                    className={`source-card ${currentSourceId === source.id || (!currentSourceId && source.title === 'Saved Messages') ? 'is-active' : ''}`}
                                    onClick={() => handleSourceSelect(source.id)}
                                >
                                    <span className="source-card__icon">
                                        {source.title === 'Saved Messages' ? (
                                            <Star size={16} />
                                        ) : source.type === 'channel' ? (
                                            <Megaphone size={16} />
                                        ) : source.type === 'user' ? (
                                            <User size={16} />
                                        ) : (
                                            <Users size={16} />
                                        )}
                                    </span>
                                    <span className="source-card__name">{source.title}</span>
                                    <span className="source-card__type">{source.type}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Player;
