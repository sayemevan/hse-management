'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useAuth } from '@/modules/auth/auth-provider';
import { useCompany } from '@/modules/tenant/tenant-provider';

import { precacheRoutes } from './registry';
import { hasUnsavedChanges } from './unsaved-changes';

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface PwaContextValue {
  updateAvailable: boolean;
  /** Activates the waiting version and reloads; refused while a form has unsaved input. */
  applyUpdate: () => boolean;
  canInstall: boolean;
  install: () => Promise<void>;
  /** iPhone and iPad have no install prompt: the menu shows "Share → Add to Home Screen". */
  showIosHint: boolean;
}

const PwaContext = createContext<PwaContextValue>({
  updateAvailable: false,
  applyUpdate: () => false,
  canInstall: false,
  install: () => Promise.resolve(),
  showIosHint: false,
});

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !('MSStream' in window);
}

/**
 * PLT-25: registers the service worker on company subdomains, pre-caches the offline pages
 * after sign-in and on a language change, offers the waiting update, and the install prompt.
 */
export function PwaProvider({ children }: { children: ReactNode }) {
  const company = useCompany();
  const { status, offline, user } = useAuth();
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [standalone, setStandalone] = useState(true);
  const [ios, setIos] = useState(false);

  // FR-1: company subdomains only, after the page has loaded.
  useEffect(() => {
    if (!company || !('serviceWorker' in navigator)) return;
    const effect = { cancelled: false };
    const url = process.env.NODE_ENV === 'production' ? '/sw.js' : '/sw.js?dev=1';
    const register = () => {
      navigator.serviceWorker
        .register(url, { scope: '/' })
        .then((reg) => {
          if (effect.cancelled) return;
          setRegistration(reg);
          if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
          reg.addEventListener('updatefound', () => {
            const installing = reg.installing;
            installing?.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                setWaiting(installing);
              }
            });
          });
        })
        .catch(() => undefined);
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    return () => {
      effect.cancelled = true;
      window.removeEventListener('load', register);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, [company]);

  // FR-3: pre-cache the offline pages once signed in (again when the language changes).
  const language = user?.effectiveLanguage;
  useEffect(() => {
    if (!registration || status !== 'signed-in' || offline) return;
    const worker = registration.active ?? navigator.serviceWorker.controller;
    worker?.postMessage({ type: 'precache', urls: precacheRoutes() });
  }, [registration, status, offline, language]);

  // FR-8: the install prompt.
  useEffect(() => {
    setStandalone(isStandalone());
    setIos(isIos());
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallEvent(null);
      setStandalone(true);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    if (!waiting || hasUnsavedChanges()) return false;
    waiting.postMessage({ type: 'skipWaiting' });
    return true;
  }, [waiting]);

  const install = useCallback(async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice.catch(() => undefined);
    setInstallEvent(null);
  }, [installEvent]);

  const value = useMemo<PwaContextValue>(
    () => ({
      updateAvailable: waiting !== null,
      applyUpdate,
      canInstall: !standalone && installEvent !== null,
      install,
      showIosHint: !standalone && ios && company !== null,
    }),
    [waiting, applyUpdate, standalone, installEvent, install, ios, company],
  );
  return <PwaContext value={value}>{children}</PwaContext>;
}

export function usePwa(): PwaContextValue {
  return useContext(PwaContext);
}
