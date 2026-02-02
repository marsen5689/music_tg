import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
    initTelegramClient,
    connectWithQR,
    connectWithPhone,
    saveSession,
} from '../utils/telegram';
import './Auth.css';

interface AuthProps {
    onAuthenticated: (session: string) => void;
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
    const [awaitingCode, setAwaitingCode] = useState(false);
    const [awaitingPassword, setAwaitingPassword] = useState(false);

    // Refs for password and code resolvers
    const passwordResolverRef = React.useRef<((value: string) => void) | null>(null);
    const codeResolverRef = React.useRef<((value: string) => void) | null>(null);

    const handleQRAuth = async () => {
        setIsLoading(true);
        setError(null);
        setPasswordHint(null);

        try {
            initTelegramClient();

            const session = await connectWithQR(
                (qr) => {
                    // Convert token to login URL (base64url format)
                    const token = qr.token
                        .toString('base64')
                        .replace(/\+/g, '-')
                        .replace(/\//g, '_')
                        .replace(/=/g, '');
                    const url = `tg://login?token=${token}`;
                    setQrCode(url);
                },
                async (hint) => {
                    // 2FA password required
                    setAwaitingPassword(true);
                    if (hint) setPasswordHint(hint);
                    setIsLoading(false);

                    return new Promise<string>((resolve) => {
                        passwordResolverRef.current = resolve;
                    });
                }
            );

            saveSession(session);
            onAuthenticated(session);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Authentication failed');
            console.error('QR Auth error:', err);
            // Reset states to allow retry
            setPassword('');
            setAwaitingPassword(false);
            setQrCode(null);
            passwordResolverRef.current = null;
        } finally {
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

            const session = await connectWithPhone(
                phoneNumber,
                async () => {
                    setAwaitingCode(true);
                    setIsLoading(false);

                    return new Promise<string>((resolve) => {
                        codeResolverRef.current = resolve;
                    });
                },
                async (hint) => {
                    // 2FA password required
                    setAwaitingPassword(true);
                    if (hint) setPasswordHint(hint);
                    setIsLoading(false);

                    return new Promise<string>((resolve) => {
                        passwordResolverRef.current = resolve;
                    });
                }
            );

            saveSession(session);
            onAuthenticated(session);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Authentication failed');
            console.error('Phone Auth error:', err);
            // Reset states to allow retry
            setPassword('');
            setCode('');
            setAwaitingPassword(false);
            setAwaitingCode(false);
            passwordResolverRef.current = null;
            codeResolverRef.current = null;
        } finally {
            setIsLoading(false);
            setAwaitingCode(false);
            setAwaitingPassword(false);
        }
    };

    const handleCodeSubmit = () => {
        if (code.length >= 5 && codeResolverRef.current) {
            setIsLoading(true);
            codeResolverRef.current(code);
            codeResolverRef.current = null;
        }
    };

    const handlePasswordSubmit = () => {
        if (password.length > 0 && passwordResolverRef.current) {
            setIsLoading(true);
            passwordResolverRef.current(password);
            passwordResolverRef.current = null;
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
                        onClick={() => setMode('qr')}
                    >
                        QR Code
                    </button>
                    <button
                        className={`auth-tab ${mode === 'phone' ? 'active' : ''}`}
                        onClick={() => setMode('phone')}
                    >
                        Phone Number
                    </button>
                </div>

                {error && (
                    <div className="error-message">
                        {error}
                        <button
                            className="error-retry-button"
                            onClick={() => {
                                setError(null);
                                setPassword('');
                                setCode('');
                                setAwaitingPassword(false);
                                setAwaitingCode(false);
                                setQrCode(null);
                            }}
                        >
                            Try Again
                        </button>
                    </div>
                )}

                {mode === 'qr' ? (
                    <div className="auth-form">
                        {awaitingPassword ? (
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
                        ) : qrCode ? (
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
                        ) : (
                            <>
                                {isLoading ? (
                                    <div className="loading-container">
                                        <div className="spinner"></div>
                                        <div className="loading-text">Connecting...</div>
                                    </div>
                                ) : (
                                    <button className="auth-button" onClick={handleQRAuth}>
                                        Generate QR Code
                                    </button>
                                )}
                            </>
                        )}
                    </div>
                ) : (
                    <div className="auth-form">
                        {awaitingPassword ? (
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
                        ) : !awaitingCode ? (
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
                        ) : (
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
                                        maxLength={5}
                                        autoFocus
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
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default Auth;
