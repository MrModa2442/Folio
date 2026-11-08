import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (import.meta.env.PROD) {
  // Register and auto-update the offline Service Worker in production builds (Vercel / iPad)
  registerSW({ immediate: true });
} else if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  // In dev preview, unregister any cached Service Worker so it doesn't serve a stale index.html without Vite's React preamble
  navigator.serviceWorker.getRegistrations().then(registrations => {
    for (const registration of registrations) {
      registration.unregister();
    }
  });
}

createRoot(document.getElementById('root')!).render(<App />);
