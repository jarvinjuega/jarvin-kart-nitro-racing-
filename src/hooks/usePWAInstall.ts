import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __deferredPwaPrompt?: BeforeInstallPromptEvent | null;
    __pwaInstalled?: boolean;
  }
}

function checkIsStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.__pwaInstalled === true ||
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function checkIsInIframe(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    typeof window !== 'undefined' ? window.__deferredPwaPrompt ?? null : null,
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(() => checkIsStandalone());
  const [isIOS] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return /iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase());
  });
  const [isInIframe] = useState<boolean>(() => checkIsInIframe());

  useEffect(() => {
    const syncState = () => {
      setDeferredPrompt(window.__deferredPwaPrompt ?? null);
      setIsInstalled(checkIsStandalone());
    };

    syncState();

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      window.__deferredPwaPrompt = e as BeforeInstallPromptEvent;
      syncState();
    };
    const handleInstalled = () => {
      window.__deferredPwaPrompt = null;
      window.__pwaInstalled = true;
      syncState();
    };

    const mql = window.matchMedia?.('(display-mode: standalone)');
    const handleDisplayChange = () => syncState();

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleInstalled);
    window.addEventListener('pwa-state-change', syncState);
    mql?.addEventListener?.('change', handleDisplayChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleInstalled);
      window.removeEventListener('pwa-state-change', syncState);
      mql?.removeEventListener?.('change', handleDisplayChange);
    };
  }, []);

  const install = useCallback(async (): Promise<boolean> => {
    const promptEv = window.__deferredPwaPrompt ?? deferredPrompt;
    if (!promptEv) return false;
    await promptEv.prompt();
    const { outcome } = await promptEv.userChoice;
    if (outcome === 'accepted') {
      window.__deferredPwaPrompt = null;
      window.__pwaInstalled = true;
      setDeferredPrompt(null);
      setIsInstalled(true);
      window.dispatchEvent(new Event('pwa-state-change'));
      return true;
    }
    return false;
  }, [deferredPrompt]);

  const topInstallUrl =
    typeof window !== 'undefined' && /^https?:\/\//i.test(window.location.origin)
      ? `${window.location.origin}/?install=1`
      : '/?install=1';

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isInIframe,
    topInstallUrl,
    install,
  };
}
