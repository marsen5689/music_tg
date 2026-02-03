import React, { useState, useEffect, useRef } from 'react';
import type { Track, AudioSource } from '../types';
import {
    fetchAudioFiles,
    downloadAudioFile,
    downloadAudioFileStreaming,
    clearSession,
    getTelegramClient,
    getAudioSources,
} from '../utils/telegram';
import {
    Play, Pause, SkipBack, SkipForward, Volume2,
    Settings, LogOut, Search, Music, Disc,
    User, Users, Megaphone, Star, X,
    AlertCircle, Loader2
} from 'lucide-react';
import './Player.css';

interface PlayerProps {
    onLogout: () => void;
}

const Player: React.FC<PlayerProps> = ({ onLogout }) => {
    const [tracks, setTracks] = useState<Track[]>([]);
    const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
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

    const filteredSources = audioSources.filter(source =>
        source.title.toLowerCase().includes(sourceSearchQuery.toLowerCase())
    );
    const [isBuffering, setIsBuffering] = useState(false);

    const audioRef = useRef<HTMLAudioElement | null>(null);
    const progressBarRef = useRef<HTMLDivElement>(null);
    const volumeBarRef = useRef<HTMLDivElement>(null);
    const trackCacheRef = useRef<Map<string, string>>(new Map()); // Cache for track URLs
    const cleanupRef = useRef<(() => void) | null>(null); // Cleanup for streaming
    const nextTrackTriggerRef = useRef<(() => void) | null>(null);
    const loadingTrackIdRef = useRef<string | null>(null);

    const loadTracks = async () => {
        setIsLoading(true);
        setTracks([]);
        setNoTracksFound(false);

        // 3-second timeout for "Nothing found"
        const timeoutId = setTimeout(() => {
            setTracks(currentTracks => {
                if (currentTracks.length === 0) {
                    setNoTracksFound(true);
                    // We can't easily cancel the fetch here as it's a promise,
                    // but the UI will show "Nothing found"
                }
                return currentTracks;
            });
        }, 3000);

        try {
            console.log('Starting to load tracks...');
            const client = getTelegramClient();
            console.log('Got Telegram client');

            // mtcute handles connection automatically in API calls
            await client.connect();
            console.log('Client ready');

            console.log('Fetching audio files...');
            const audioFiles = await fetchAudioFiles(currentSourceId, (track) => {
                setTracks(prev => {
                    const exists = prev.some(t => t.id === track.id);
                    if (exists) return prev;
                    if (prev.length === 0) {
                        setNoTracksFound(false);
                        clearTimeout(timeoutId);
                    }
                    return [...prev, track];
                });
            });
            console.log('Found', audioFiles.length, 'audio files');
            // Final sync
            setTracks(audioFiles);
        } catch (error) {
            console.error('Failed to load tracks:', error);
            console.error('Error details:', {
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                error
            });
            setTracks(current => {
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



    const [pendingTrack, setPendingTrack] = useState<Track | null>(null);

    const playTrack = async (track: Track) => {
        if (currentTrack?.id === track.id && audioRef.current) {
            // Toggle play/pause for current track
            if (isPlaying) {
                audioRef.current.pause();
                setIsPlaying(false);
            } else {
                audioRef.current.play();
                setIsPlaying(true);
            }
            return;
        }

        // New track selected
        setPendingTrack(track);
        loadingTrackIdRef.current = track.id;

        // Do NOT set currentTrack or isBuffering yet. 
        // We want the old track to keep playing.

        setLoadingProgress(0);

        try {
            let url: string;
            let cleanup: (() => void) | undefined;

            // Check if track is already cached
            if (trackCacheRef.current.has(track.id)) {
                console.log('Using cached track:', track.title);
                url = trackCacheRef.current.get(track.id)!;
            } else {
                console.log('Streaming track:', track.title);

                try {
                    // Try streaming download first
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
                    console.log('Using streaming playback');
                } catch (streamError) {
                    if (loadingTrackIdRef.current !== track.id) return;
                    console.warn('Streaming failed, falling back to regular download:', streamError);
                    // Fallback to regular regular download
                    const blob = await downloadAudioFile(track.messageId, track.chatId, (progress) => {
                        if (loadingTrackIdRef.current === track.id) {
                            setLoadingProgress(progress);
                        }
                    });
                    url = URL.createObjectURL(blob);
                }

                if (loadingTrackIdRef.current !== track.id) {
                    // Request cancelled
                    if (cleanup) cleanup();
                    return;
                }

                // Cache the URL only if it's a full download (no cleanup function)
                if (!cleanup) {
                    trackCacheRef.current.set(track.id, url);
                }
            }

            // Clean up previous pending download if any
            if (cleanupRef.current) {
                cleanupRef.current();
                cleanupRef.current = null;
            }
            if (cleanup) {
                cleanupRef.current = cleanup;
            }

            // Create new Audio instance for the next track
            const nextAudio = new Audio(url);
            nextAudio.volume = volume;

            // Wait for it to be ready to play
            nextAudio.oncanplay = async () => {
                // Ensure this is still the requested track
                if (loadingTrackIdRef.current !== track.id) return;

                // Stop the old track
                if (audioRef.current) {
                    audioRef.current.pause();
                    audioRef.current.src = '';
                    audioRef.current.ontimeupdate = null;
                    audioRef.current.onended = null;
                }

                // Swap references
                audioRef.current = nextAudio;

                // Setup listeners on the new active audio
                nextAudio.ontimeupdate = () => {
                    setCurrentTime(nextAudio.currentTime);
                };

                nextAudio.onended = () => {
                    nextTrackTriggerRef.current?.();
                };

                // Update UI state
                setCurrentTrack(track);
                setPendingTrack(null);
                setIsBuffering(false);
                setDuration(nextAudio.duration || 0);
                setIsPlaying(true);

                try {
                    await nextAudio.play();
                } catch (e) {
                    console.error("Playback failed", e);
                }
            };

            nextAudio.onerror = (e) => {
                if (loadingTrackIdRef.current !== track.id) {
                    console.log('Ignored error for cancelled track load:', track.title);
                    return;
                }
                console.error("Error loading new track", e);
                setPendingTrack(null);
                alert("Failed to load track");
            };

            // Trigger load
            nextAudio.load();

        } catch (error) {
            if (loadingTrackIdRef.current !== track.id) return;
            console.error('Failed to play track:', error);
            setPendingTrack(null);
            alert(`Failed to play track: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    };



    const playNext = () => {
        // We look up based on the *latest* currentTrack state or the passed ID? 
        // playNext uses 'currentTrack' from state.
        // But if we are in the middle of a transition, currentTrack is the OLD one. 
        // playNext should find the one AFTER the OLD one? 
        // Yes, that's correct behavior for "skip".
        // But for "onEnded", currentTrack is the one that just finished. Correct.

        // We need to access the LATEST currentTrack.
        // Since playNext is recreated on render (it uses closure state), it should be fine IF 
        // we keep the onended listener up to date.
        // But we attach onended ONCE when swapping.
        // So we need `nextTrackTriggerRef` to always point to the fresh playNext.
        // And the listener calls `nextTrackTriggerRef.current()`.

        // Logic for playNext:
        if (!currentTrack) return;
        const currentIndex = tracks.findIndex(t => t.id === currentTrack.id);
        if (currentIndex < tracks.length - 1) {
            playTrack(tracks[currentIndex + 1]);
        }
    };

    const playPrevious = () => {
        if (!currentTrack) return;
        const currentIndex = tracks.findIndex(t => t.id === currentTrack.id);
        if (currentIndex > 0) {
            playTrack(tracks[currentIndex - 1]);
        }
    };

    const togglePlayPause = () => {
        if (!audioRef.current || !currentTrack) return;

        if (isPlaying) {
            audioRef.current.pause();
            setIsPlaying(false);
        } else {
            audioRef.current.play();
            setIsPlaying(true);
        }
    };

    // Keep the nextTrackTriggerRef updated with the latest playNext closure
    useEffect(() => {
        nextTrackTriggerRef.current = playNext;
    }, [playNext]);

    // Initial audio setup (empty, but ensuring ref is controlled if needed)
    useEffect(() => {
        if (!audioRef.current) {
            audioRef.current = new Audio();
        }

        return () => {
            // Cleanup on unmount
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            if (cleanupRef.current) {
                cleanupRef.current();
            }
        };
    }, []);

    const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!audioRef.current || !progressBarRef.current) return;

        const rect = progressBarRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = x / rect.width;
        const newTime = percentage * duration;

        audioRef.current.currentTime = newTime;
        setCurrentTime(newTime);
    };

    const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!volumeBarRef.current) return;

        const rect = volumeBarRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const percentage = Math.max(0, Math.min(1, x / rect.width));

        setVolume(percentage);
    };

    const formatTime = (seconds: number): string => {
        if (isNaN(seconds)) return '0:00';

        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    const handleLogout = () => {
        if (audioRef.current) {
            audioRef.current.pause();
        }

        // Cleanup active stream
        if (cleanupRef.current) {
            cleanupRef.current();
            cleanupRef.current = null;
        }

        // Clean up cached URLs
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

    const [searchQuery, setSearchQuery] = useState('');

    const filteredTracks = tracks.filter(track =>
        track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        track.artist.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="player-container fade-in">
            {/* audio element is managed via new Audio() */}

            <div className="player-header">
                <div className="player-logo">
                    <Music className="player-logo-icon" size={32} />
                    <span>Music Tg</span>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="logout-button" onClick={handleOpenSettings} title="Settings">
                        <Settings size={20} />
                    </button>
                    <button className="logout-button" onClick={handleLogout} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <LogOut size={16} />
                        Logout
                    </button>
                </div>
            </div>

            <div className="player-main">
                <div className="track-list-container">
                    <div className="track-list-header">
                        <div className="search-container">
                            <Search className="search-icon" size={16} />
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Search tracks..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                            />
                        </div>
                        <p className="track-count">
                            {filteredTracks.length} tracks
                        </p>
                    </div>

                    {filteredTracks.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-icon"><Disc size={48} opacity={0.5} /></div>
                            <div className="empty-text">
                                {searchQuery ? 'No tracks found' : 'No music found in Saved Messages'}
                            </div>
                        </div>
                    ) : (
                        <div className="track-list">
                            {filteredTracks.map((track, index) => (
                                <button
                                    key={track.id}
                                    className={`track-item ${currentTrack?.id === track.id ? 'active playing' : ''
                                        }`}
                                    onClick={() => playTrack(track)}
                                >
                                    <div className="track-number">
                                        {pendingTrack?.id === track.id ? (
                                            <Loader2 className="animate-spin" size={14} />
                                        ) : currentTrack?.id === track.id && isPlaying ? (
                                            <span className="track-play-icon"><Play size={14} fill="currentColor" /></span>
                                        ) : (
                                            index + 1
                                        )}
                                    </div>
                                    <div className="track-info">
                                        <div className="track-title">{track.title}</div>
                                        <div className="track-artist">{track.artist}</div>
                                    </div>
                                    <div className="track-duration">
                                        {formatTime(track.duration)}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {currentTrack && (
                <div className="player-controls-container">
                    <div className="now-playing">
                        <div className="now-playing-artwork">
                            <Music size={32} />
                        </div>
                        <div className="now-playing-info">
                            <div className="now-playing-title">{currentTrack.title}</div>
                            <div className="now-playing-artist">{currentTrack.artist}</div>
                        </div>
                    </div>

                    {isBuffering && (
                        <div className="buffer-loading-container">
                            <div className="buffer-loading-bar" style={{ width: `${Math.max(10, loadingProgress)}%` }} />
                        </div>
                    )}

                    <div className="player-controls">
                        <div className="progress-container">
                            <span className="time-display">{formatTime(currentTime)}</span>
                            <div
                                ref={progressBarRef}
                                className="progress-bar"
                                onClick={handleProgressClick}
                            >
                                <div
                                    className="progress-fill"
                                    style={{ width: `${progressPercentage}%` }}
                                />
                            </div>
                            <span className="time-display">{formatTime(duration)}</span>
                        </div>

                        <div className="controls-buttons">
                            <button
                                className="control-button"
                                onClick={playPrevious}
                                disabled={!currentTrack}
                            >
                                <SkipBack size={20} fill="currentColor" />
                            </button>
                            <button
                                className="control-button play-button"
                                onClick={togglePlayPause}
                                disabled={!currentTrack}
                            >
                                {isPlaying ? <Pause size={28} fill="currentColor" /> : <Play size={28} fill="currentColor" style={{ marginLeft: '4px' }} />}
                            </button>
                            <button
                                className="control-button"
                                onClick={playNext}
                                disabled={!currentTrack}
                            >
                                <SkipForward size={20} fill="currentColor" />
                            </button>

                            <div className="volume-container">
                                <Volume2 size={20} className="volume-icon" />
                                <div
                                    ref={volumeBarRef}
                                    className="volume-slider"
                                    onClick={handleVolumeClick}
                                >
                                    <div
                                        className="volume-fill"
                                        style={{ width: `${volume * 100}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {isLoading && tracks.length === 0 && !noTracksFound && (
                <div className="loading-overlay">
                    <div className="loading-content">
                        <Loader2 className="spinner-icon" size={48} />
                        <div className="loading-text">
                            Searching for music...
                        </div>
                    </div>
                </div>
            )}

            {noTracksFound && tracks.length === 0 && (
                <div className="loading-overlay">
                    <div className="loading-content">
                        <div className="empty-icon"><AlertCircle size={48} /></div>
                        <div className="loading-text">
                            Nothing found
                        </div>
                        <button className="logout-button" style={{ marginTop: '20px' }} onClick={() => {
                            setNoTracksFound(false);
                            loadTracks();
                        }}>
                            Try Again
                        </button>
                    </div>
                </div>
            )}

            {showSettings && (
                <div className="settings-overlay fade-in" onClick={() => setShowSettings(false)}>
                    <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="settings-header">
                            <h3>Select Source</h3>
                            <button className="close-button" onClick={() => setShowSettings(false)}><X size={24} /></button>
                        </div>
                        <div className="settings-search" style={{ padding: '16px 24px 0' }}>
                            <div className="search-container">
                                <Search className="search-icon" size={18} />
                                <input
                                    type="text"
                                    className="search-input"
                                    placeholder="Search chats..."
                                    value={sourceSearchQuery}
                                    onChange={(e) => setSourceSearchQuery(e.target.value)}
                                    autoFocus
                                />
                            </div>
                        </div>
                        <div className="settings-sources-list">
                            {filteredSources.map((source) => (
                                <button
                                    key={source.id}
                                    className={`source-item ${currentSourceId === source.id || (!currentSourceId && source.title === 'Saved Messages') ? 'active' : ''}`}
                                    onClick={() => handleSourceSelect(source.id)}
                                >
                                    <span className="source-icon">
                                        {source.title === 'Saved Messages' ? <Star size={18} /> :
                                            source.type === 'channel' ? <Megaphone size={18} /> :
                                                source.type === 'user' ? <User size={18} /> : <Users size={18} />}
                                    </span>
                                    <span className="source-name">{source.title}</span>
                                    {source.type === 'channel' && <span className="source-badge">Channel</span>}
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
