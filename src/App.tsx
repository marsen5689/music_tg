import { useState, useEffect } from 'react';
import Auth from './components/Auth';
import Player from './components/Player';
import { initTelegramClient, isAuthenticated } from './utils/telegram';
import './App.css';

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState<boolean | null>(null);

  useEffect(() => {
    // Check for existing session
    const checkAuth = async () => {
      try {
        // Initialize client (will reuse stored session if exists)
        initTelegramClient();

        // Check if we have a valid session
        const hasSession = localStorage.getItem('mtcute_initialized');
        if (hasSession) {
          const authenticated = await isAuthenticated();
          setIsLoggedIn(authenticated);
        } else {
          setIsLoggedIn(false);
        }
      } catch (error) {
        console.error('Failed to check auth:', error);
        setIsLoggedIn(false);
      }
    };

    checkAuth();
  }, []);

  const handleAuthenticated = () => {
    console.log('App: Authentication successful');
    setIsLoggedIn(true);
  };

  const handleLogout = () => {
    localStorage.removeItem('mtcute_initialized');
    setIsLoggedIn(false);
  };

  // Show loading while checking auth
  if (isLoggedIn === null) {
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
      {isLoggedIn ? (
        <Player onLogout={handleLogout} />
      ) : (
        <Auth onAuthenticated={handleAuthenticated} />
      )}
    </>
  );
}

export default App;
