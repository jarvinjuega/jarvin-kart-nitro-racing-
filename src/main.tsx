import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

interface EarlyBeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __deferredPwaPrompt?: EarlyBeforeInstallPromptEvent | null;
    __pwaInstalled?: boolean;
  }
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.__deferredPwaPrompt = e as EarlyBeforeInstallPromptEvent;
  window.dispatchEvent(new Event('pwa-state-change'));
});

window.addEventListener('appinstalled', () => {
  window.__deferredPwaPrompt = null;
  window.__pwaInstalled = true;
  window.dispatchEvent(new Event('pwa-state-change'));
});

registerSW({
  immediate: true,
});

createRoot(document.getElementById('root')!).render(<App />);
