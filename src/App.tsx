import { useState, useEffect } from 'react';
import Auth from './components/Auth';
import Player from './components/Player';
import { loadSession, initTelegramClient } from './utils/telegram';
import './App.css';

function App() {
  const [session, setSession] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  useEffect(() => {
    // Check for existing session
    const savedSession = loadSession();
    if (savedSession) {
      try {
        initTelegramClient(savedSession);
        setSession(savedSession);
      } catch (error) {
        console.error('Failed to restore session:', error);
      }
    }
    setIsInitializing(false);
  }, []);

  const handleAuthenticated = (newSession: string) => {
    console.log('App: Authentication successful, initializing client with new session');
    try {
      initTelegramClient(newSession);
      setSession(newSession);
      console.log('App: Client initialized successfully');
    } catch (error) {
      console.error('App: Failed to initialize client with new session:', error);
    }
  };

  const handleLogout = () => {
    setSession(null);
  };

  if (isInitializing) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--bg-primary)',
      }}>
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <>
      {session ? (
        <Player onLogout={handleLogout} />
      ) : (
        <Auth onAuthenticated={handleAuthenticated} />
      )}
    </>
  );
}

export default App;
