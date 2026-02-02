import { Buffer } from 'buffer';

// Polyfill Buffer globally for gramjs
if (typeof window !== 'undefined') {
  window.Buffer = window.Buffer || Buffer;
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
