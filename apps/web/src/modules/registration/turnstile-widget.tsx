'use client';

import type { Language } from '@hse/shared';
import { type Ref, useEffect, useImperativeHandle, useRef } from 'react';

import { publicEnv } from '@/config/public-env';

interface TurnstileApi {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  reset: (widgetId: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile did not load'));
    };
    script.onerror = () => {
      scriptPromise = null;
      reject(new Error('Turnstile did not load'));
    };
    document.head.append(script);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  /** Tokens are single use: call after every submission attempt. */
  reset: () => void;
}

/**
 * Cloudflare Turnstile bot check (T-11). The token it produces is verified by the API;
 * the widget itself only proves nothing. `onToken(null)` means the token expired or failed.
 */
export function TurnstileWidget({
  language,
  onToken,
  onLoadError,
  ref,
}: {
  language: Language;
  onToken: (token: string | null) => void;
  onLoadError: () => void;
  ref?: Ref<TurnstileHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const callbacks = useRef({ onToken, onLoadError });

  useEffect(() => {
    callbacks.current = { onToken, onLoadError };
  });

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetId.current && window.turnstile) window.turnstile.reset(widgetId.current);
      callbacks.current.onToken(null);
    },
  }));

  useEffect(() => {
    const effect = { cancelled: false };
    loadTurnstile().then(
      (turnstile) => {
        if (effect.cancelled || !container.current) return;
        widgetId.current = turnstile.render(container.current, {
          sitekey: publicEnv.turnstileSiteKey,
          language,
          size: 'flexible',
          theme: 'light',
          callback: (token: string) => {
            callbacks.current.onToken(token);
          },
          'expired-callback': () => {
            callbacks.current.onToken(null);
          },
          'error-callback': () => {
            callbacks.current.onToken(null);
          },
        });
      },
      () => {
        if (!effect.cancelled) callbacks.current.onLoadError();
      },
    );
    return () => {
      effect.cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
      // A re-render (e.g. after a language switch) issues a new token.
      callbacks.current.onToken(null);
    };
  }, [language]);

  return <div ref={container} className="min-h-16" />;
}
