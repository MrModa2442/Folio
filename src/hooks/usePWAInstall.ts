import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isPersistedStorage, setIsPersistedStorage] = useState(false);

  useEffect(() => {
    // Request persistent storage so iPadOS / Safari does not evict IndexedDB PDFs
    if (navigator.storage && navigator.storage.persist) {
      navigator.storage
        .persist()
        .then(persisted => setIsPersistedStorage(persisted))
        .catch(() => {});
    }

    // Detect standalone mode (already installed to Home Screen)
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    setIsInstalled(isStandalone);

    // Detect iOS & iPadOS (note: iPadOS 13+ Safari reports MacIntel with maxTouchPoints > 1)
    const userAgent = window.navigator.userAgent.toLowerCase();
    const isIPadOS =
      window.navigator.platform === 'MacIntel' && window.navigator.maxTouchPoints > 1;
    const isIOSDevice = /iphone|ipad|ipod/.test(userAgent) || isIPadOS;
    setIsIOS(isIOSDevice);

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const install = async () => {
    if (!deferredPrompt) return false;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setIsInstalled(true);
      setDeferredPrompt(null);
      return true;
    }
    return false;
  };

  return {
    isInstallable: Boolean(deferredPrompt),
    isInstalled,
    isIOS,
    isPersistedStorage,
    install,
  };
}
