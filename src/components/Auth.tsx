import React, { useState, useCallback } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
    initTelegramClient,
    startPhoneAuth,
    submitCode,
    submit2FA,
    startQRAuth,
    stopQRAuth,
    type AuthState,
} from '../utils/telegram';
import './Auth.css';

interface AuthProps {
    onAuthenticated: () => void;
}

type AuthMode = 'qr' | 'phone';

const Auth: React.FC<AuthProps> = ({ onAuthenticated }) => {
    // Check if API credentials are present
    const apiId = import.meta.env.VITE_API_ID;
    const apiHash = import.meta.env.VITE_API_HASH;
    const isConfigured = apiId && apiHash && apiId !== '0' && apiId !== '';

    if (!isConfigured) {
        return (
            <div className="auth-container fade-in">
                <div className="auth-card">
                    <div className="auth-header">
                        <div className="auth-logo">⚠️</div>
                        <h1 className="auth-title">Configuration Error</h1>
                        <p className="auth-subtitle">
                            Telegram API credentials are missing.
                        </p>
                    </div>
                    <div className="error-message" style={{ textAlign: 'left', background: 'rgba(255, 50, 50, 0.1)', padding: '15px', borderRadius: '8px', marginTop: '20px' }}>
                        <p><strong>To fix this on GitHub Pages:</strong></p>
                        <ol style={{ paddingLeft: '20px', marginTop: '10px', lineHeight: '1.6' }}>
                            <li>Go to <strong>Settings</strong> &rarr; <strong>Secrets and variables</strong> &rarr; <strong>Actions</strong></li>
                            <li>Add <strong>Repository secret</strong> (not Environment secret):</li>
                            <li>Name: <code>VITE_API_ID</code>, Value: <i>(your ID numbers)</i></li>
                            <li>Name: <code>VITE_API_HASH</code>, Value: <i>(your Hash string)</i></li>
                            <li>Go to <strong>Actions</strong> tab &rarr; Select last workflow &rarr; <strong>Re-run all jobs</strong></li>
                        </ol>
                        <p style={{ marginTop: '10px', fontSize: '0.9em' }}>Current value: ID={apiId ? 'Has Value' : 'Empty'}, Hash={apiHash ? 'Has Value' : 'Empty'}</p>
                    </div>
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

    // Auth state from the new flow
    const [authState, setAuthState] = useState<AuthState>({ step: 'idle' });

    // Auth callbacks
    const handleStateChange = useCallback((state: AuthState) => {
        console.log('[Auth] State changed:', state.step);
        setAuthState(state);
        setIsLoading(false);

        switch (state.step) {
            case 'done':
                // Mark as initialized for session check
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
            console.error('QR Auth error:', err);
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
            console.error('Phone Auth error:', err);
            setIsLoading(false);
        }
    };

    const handleCodeSubmit = async () => {
        if (code.length < 5 || authState.step !== 'code') {
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            await submitCode(
                authState.phone,
                code,
                authState.phoneCodeHash,
                { onStateChange: handleStateChange }
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Verification failed');
            setIsLoading(false);
        }
    };

    const handlePasswordSubmit = async () => {
        if (!password) {
            return;
        }

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
        // Stop QR polling when switching modes
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

    // Determine what to render based on auth state
    const renderAuthContent = () => {
        // 2FA screen (same for both modes)
        if (authState.step === '2fa') {
            return (
                <>
                    <div className="form-group">
                        <label className="form-label">Two-Factor Authentication</label>
                        <p className="form-hint">
                            {passwordHint
                                ? <>Hint: <strong>{passwordHint}</strong></>
                                : 'Your account has 2FA enabled. Please enter your cloud password.'}
                        </p>
                        <input
                            type="password"
                            className="form-input"
                            placeholder="Enter your 2FA password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={isLoading}
                            autoFocus
                            onKeyDown={(e) => e.key === 'Enter' && handlePasswordSubmit()}
                        />
                    </div>
                    <button
                        className="auth-button"
                        onClick={handlePasswordSubmit}
                        disabled={isLoading || !password}
                    >
                        {isLoading ? 'Verifying...' : 'Submit'}
                    </button>
                </>
            );
        }

        if (mode === 'qr') {
            // QR Code mode
            if (qrCode) {
                return (
                    <div className="qr-container">
                        <div className="qr-code">
                            <QRCodeSVG value={qrCode} size={200} />
                        </div>
                        <div className="qr-instructions">
                            <strong>Scan with Telegram</strong>
                            Open Telegram on your phone, go to Settings → Devices → Link
                            Desktop Device, and scan this QR code
                        </div>
                    </div>
                );
            }

            return isLoading ? (
                <div className="loading-container">
                    <div className="spinner"></div>
                    <div className="loading-text">Connecting...</div>
                </div>
            ) : (
                <button className="auth-button" onClick={handleQRAuth}>
                    Generate QR Code
                </button>
            );
        } else {
            // Phone mode
            if (authState.step === 'code') {
                return (
                    <>
                        <div className="form-group">
                            <label className="form-label">Verification Code</label>
                            <input
                                type="text"
                                className="form-input"
                                placeholder="12345"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                disabled={isLoading}
                                maxLength={6}
                                autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && handleCodeSubmit()}
                            />
                        </div>
                        <button
                            className="auth-button"
                            onClick={handleCodeSubmit}
                            disabled={isLoading || code.length < 5}
                        >
                            {isLoading ? 'Verifying...' : 'Verify'}
                        </button>
                    </>
                );
            }

            return (
                <>
                    <div className="form-group">
                        <label className="form-label">Phone Number</label>
                        <input
                            type="tel"
                            className="form-input"
                            placeholder="+1234567890"
                            value={phoneNumber}
                            onChange={(e) => setPhoneNumber(e.target.value)}
                            disabled={isLoading}
                            onKeyDown={(e) => e.key === 'Enter' && handlePhoneAuth()}
                        />
                    </div>
                    <button
                        className="auth-button"
                        onClick={handlePhoneAuth}
                        disabled={isLoading || !phoneNumber}
                    >
                        {isLoading ? 'Sending code...' : 'Send Code'}
                    </button>
                </>
            );
        }
    };

    return (
        <div className="auth-container fade-in">
            <div className="auth-card">
                <div className="auth-header">
                    <div className="auth-logo">🎵</div>
                    <h1 className="auth-title">Music TG</h1>
                    <p className="auth-subtitle">
                        Connect your Telegram to access your music
                    </p>
                </div>

                <div className="auth-tabs">
                    <button
                        className={`auth-tab ${mode === 'qr' ? 'active' : ''}`}
                        onClick={() => handleModeChange('qr')}
                    >
                        QR Code
                    </button>
                    <button
                        className={`auth-tab ${mode === 'phone' ? 'active' : ''}`}
                        onClick={() => handleModeChange('phone')}
                    >
                        Phone Number
                    </button>
                </div>

                {error && (
                    <div className="error-message">
                        {error}
                        <button
                            className="error-retry-button"
                            onClick={handleRetry}
                        >
                            Try Again
                        </button>
                    </div>
                )}

                <div className="auth-form">
                    {renderAuthContent()}
                </div>
            </div>
        </div>
    );
};

export default Auth;
