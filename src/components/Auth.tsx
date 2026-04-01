import React, { useCallback, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
    initTelegramClient,
    startPhoneAuth,
    startQRAuth,
    stopQRAuth,
    submit2FA,
    submitCode,
    type AuthState,
} from '../utils/telegram';
import {
    AlertTriangle,
    LockKeyhole,
    Music,
    QrCode,
    ShieldCheck,
    Smartphone,
    Sparkles,
    Waves,
} from 'lucide-react';
import './Auth.css';

interface AuthProps {
    onAuthenticated: () => void;
}

type AuthMode = 'qr' | 'phone';

const Auth: React.FC<AuthProps> = ({ onAuthenticated }) => {
    const apiId = import.meta.env.VITE_API_ID;
    const apiHash = import.meta.env.VITE_API_HASH;
    const isConfigured = apiId && apiHash && apiId !== '0' && apiId !== '';

    if (!isConfigured) {
        return (
            <div className="auth-scene fade-in">
                <div className="auth-grid">
                    <section className="auth-story auth-story--error">
                        <div className="auth-story__badge">
                            <AlertTriangle size={14} />
                            <span>Configuration required</span>
                        </div>
                        <h1>Telegram API keys are missing.</h1>
                        <p>Before the redesigned experience can work, this app needs valid `VITE_API_ID` and `VITE_API_HASH` values.</p>
                    </section>

                    <section className="auth-panel">
                        <div className="error-message auth-panel__error">
                            <p><strong>How to fix it on GitHub Pages</strong></p>
                            <ol>
                                <li>Open repository Settings, then Secrets and variables, then Actions.</li>
                                <li>Add `VITE_API_ID` as a repository secret.</li>
                                <li>Add `VITE_API_HASH` as a repository secret.</li>
                                <li>Re-run the latest deployment workflow.</li>
                            </ol>
                            <p>Current values: ID={apiId ? 'set' : 'empty'}, Hash={apiHash ? 'set' : 'empty'}</p>
                        </div>
                    </section>
                </div>
            </div>
        );
    }

    const [mode, setMode] = useState<AuthMode>('qr');
    const [phoneNumber, setPhoneNumber] = useState('');
    const [code, setCode] = useState('');
    const [password, setPassword] = useState('');
    const [passwordHint, setPasswordHint] = useState<string | null>(null);
    const [qrCode, setQrCode] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [authState, setAuthState] = useState<AuthState>({ step: 'idle' });
    const [showStory, setShowStory] = useState(false);

    const handleStateChange = useCallback((state: AuthState) => {
        setAuthState(state);
        setIsLoading(false);

        switch (state.step) {
            case 'done':
                localStorage.setItem('mtcute_initialized', 'true');
                onAuthenticated();
                break;
            case 'error':
                setError(state.message);
                break;
            case '2fa':
                setPasswordHint(state.hint || null);
                break;
            case 'qr':
                setQrCode(state.url);
                break;
        }
    }, [onAuthenticated]);

    const handleQRAuth = async () => {
        setIsLoading(true);
        setError(null);
        setPasswordHint(null);

        try {
            initTelegramClient();
            await startQRAuth({ onStateChange: handleStateChange });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Authentication failed');
            setIsLoading(false);
        }
    };

    const handlePhoneAuth = async () => {
        if (!phoneNumber) {
            setError('Please enter your phone number');
            return;
        }

        setIsLoading(true);
        setError(null);
        setPasswordHint(null);

        try {
            initTelegramClient();
            await startPhoneAuth(phoneNumber, { onStateChange: handleStateChange });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Authentication failed');
            setIsLoading(false);
        }
    };

    const handleCodeSubmit = async () => {
        if (code.length < 5 || authState.step !== 'code') return;

        setIsLoading(true);
        setError(null);

        try {
            await submitCode(authState.phone, code, authState.phoneCodeHash, { onStateChange: handleStateChange });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Verification failed');
            setIsLoading(false);
        }
    };

    const handlePasswordSubmit = async () => {
        if (!password) return;

        setIsLoading(true);
        setError(null);

        try {
            await submit2FA(password, { onStateChange: handleStateChange });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Password verification failed');
            setIsLoading(false);
        }
    };

    const handleModeChange = (newMode: AuthMode) => {
        stopQRAuth();
        setMode(newMode);
        setAuthState({ step: 'idle' });
        setError(null);
        setQrCode(null);
        setCode('');
        setPassword('');
    };

    const handleRetry = () => {
        stopQRAuth();
        setError(null);
        setPassword('');
        setCode('');
        setAuthState({ step: 'idle' });
        setQrCode(null);
    };

    const renderAuthContent = () => {
        if (authState.step === '2fa') {
            return (
                <>
                    <div className="form-group">
                        <label className="form-label">Two-factor password</label>
                        <p className="form-hint">
                            {passwordHint
                                ? <>Hint: <strong>{passwordHint}</strong></>
                                : 'This account uses cloud password protection.'}
                        </p>
                        <input
                            type="password"
                            className="form-input"
                            placeholder="Enter your password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            disabled={isLoading}
                            autoFocus
                            onKeyDown={(event) => event.key === 'Enter' && handlePasswordSubmit()}
                        />
                    </div>
                    <button className="auth-button" onClick={handlePasswordSubmit} disabled={isLoading || !password}>
                        {isLoading ? 'Verifying...' : 'Unlock account'}
                    </button>
                </>
            );
        }

        if (mode === 'qr') {
            if (qrCode) {
                return (
                    <div className="qr-block">
                        <div className="qr-code">
                            <QRCodeSVG value={qrCode} size={210} />
                        </div>
                        <div className="qr-copy">
                            <strong>Scan with Telegram</strong>
                            <p>Open Telegram on your phone, then go to Settings, Devices, Link Desktop Device and scan this code.</p>
                        </div>
                    </div>
                );
            }

            return isLoading ? (
                <div className="loading-container">
                    <div className="spinner" />
                    <div className="loading-text">Generating a secure QR session...</div>
                </div>
            ) : (
                <button className="auth-button" onClick={handleQRAuth}>
                    Generate QR code
                </button>
            );
        }

        if (authState.step === 'code') {
            return (
                <>
                    <div className="form-group">
                        <label className="form-label">Verification code</label>
                        <input
                            type="text"
                            className="form-input"
                            placeholder="12345"
                            value={code}
                            onChange={(event) => setCode(event.target.value)}
                            disabled={isLoading}
                            maxLength={6}
                            autoFocus
                            onKeyDown={(event) => event.key === 'Enter' && handleCodeSubmit()}
                        />
                    </div>
                    <button className="auth-button" onClick={handleCodeSubmit} disabled={isLoading || code.length < 5}>
                        {isLoading ? 'Verifying...' : 'Confirm code'}
                    </button>
                </>
            );
        }

        return (
            <>
                <div className="form-group">
                    <label className="form-label">Phone number</label>
                    <input
                        type="tel"
                        className="form-input"
                        placeholder="+1234567890"
                        value={phoneNumber}
                        onChange={(event) => setPhoneNumber(event.target.value)}
                        disabled={isLoading}
                        onKeyDown={(event) => event.key === 'Enter' && handlePhoneAuth()}
                    />
                </div>
                <button className="auth-button" onClick={handlePhoneAuth} disabled={isLoading || !phoneNumber}>
                    {isLoading ? 'Sending code...' : 'Send login code'}
                </button>
            </>
        );
    };

    return (
        <div className="auth-scene fade-in">
            <div className="auth-ambient auth-ambient--one" />
            <div className="auth-ambient auth-ambient--two" />

            <div className="auth-grid">
                <section className="auth-panel auth-panel--primary">
                    <div className="auth-panel__brand">
                        <div className="auth-story__mark">
                            <Music size={24} />
                        </div>
                        <div>
                            <p className="eyebrow">Connect</p>
                            <strong>Music TG</strong>
                        </div>
                    </div>

                    <div className="auth-panel__header">
                        <h2>Connect Telegram</h2>
                        <p className="auth-panel__subtitle">Вход сразу перед глазами. Выбери удобный способ и продолжай.</p>
                    </div>

                    <div className="auth-tabs">
                        <button
                            className={`auth-tab ${mode === 'qr' ? 'active' : ''}`}
                            onClick={() => handleModeChange('qr')}
                        >
                            <QrCode size={16} />
                            <span>QR Code</span>
                        </button>
                        <button
                            className={`auth-tab ${mode === 'phone' ? 'active' : ''}`}
                            onClick={() => handleModeChange('phone')}
                        >
                            <Smartphone size={16} />
                            <span>Phone</span>
                        </button>
                    </div>

                    {error && (
                        <div className="error-message">
                            <span>{error}</span>
                            <button className="error-retry-button" onClick={handleRetry}>
                                Try Again
                            </button>
                        </div>
                    )}

                    <div className="auth-form">
                        {renderAuthContent()}
                    </div>

                    <button
                        className="auth-story-toggle"
                        onClick={() => setShowStory((value) => !value)}
                    >
                        <Sparkles size={16} />
                        <span>{showStory ? 'Скрыть описание' : 'Что это?'}</span>
                    </button>
                </section>

                {showStory && (
                    <section className="auth-story auth-story--collapsible">
                        <div className="auth-story__badge">
                            <Sparkles size={14} />
                            <span>About Music TG</span>
                        </div>

                        <h1>Turn your Telegram archive into a polished listening space.</h1>
                        <p>
                            Sign in once, sync your music sources, and explore a redesigned player crafted to feel cinematic, modern, and focused.
                        </p>

                        <div className="auth-feature-list">
                            <div className="auth-feature">
                                <Waves size={18} />
                                <div>
                                    <strong>Unified library view</strong>
                                    <span>Saved Messages, chats, and channels in one flow.</span>
                                </div>
                            </div>
                            <div className="auth-feature">
                                <ShieldCheck size={18} />
                                <div>
                                    <strong>Secure Telegram sign-in</strong>
                                    <span>QR and phone-based auth, plus 2FA support.</span>
                                </div>
                            </div>
                            <div className="auth-feature">
                                <LockKeyhole size={18} />
                                <div>
                                    <strong>Private session handling</strong>
                                    <span>Your mtcute session stays managed locally in the browser.</span>
                                </div>
                            </div>
                        </div>
                    </section>
                )}
            </div>
        </div>
    );
};

export default Auth;
