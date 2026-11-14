'use client';

import { useEffect, useRef } from 'react';
import { mountChallenge, TURNSTILE_SCRIPT, type TurnstileApi } from '@/lib/turnstile';

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

interface Props {
  readonly siteKey: string;
  readonly onToken: (token: string | null) => void;
  readonly onUnavailable: () => void;
}

export function TurnstileChallenge({ siteKey, onToken, onUnavailable }: Props) {
  const container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = container.current;
    if (element === null) return;
    let active = true;
    let dispose: (() => void) | undefined;
    let script: HTMLScriptElement | undefined;
    const timer = setTimeout(() => {
      if (!active) return;
      active = false;
      dispose?.();
      onToken(null);
      onUnavailable();
    }, 15_000);
    const start = () => {
      if (!active || window.turnstile === undefined) return;
      clearTimeout(timer);
      try {
        dispose = mountChallenge(window.turnstile, element, siteKey, {
          token: onToken,
          unavailable: onUnavailable,
        });
      } catch {
        onToken(null);
        onUnavailable();
      }
    };
    if (window.turnstile !== undefined) start();
    else {
      script = document.createElement('script');
      script.src = TURNSTILE_SCRIPT;
      script.async = true;
      script.onload = start;
      script.onerror = () => {
        if (!active) return;
        clearTimeout(timer);
        onToken(null);
        onUnavailable();
      };
      document.head.append(script);
    }
    return () => {
      active = false;
      clearTimeout(timer);
      dispose?.();
      script?.remove();
    };
  }, [siteKey, onToken, onUnavailable]);

  return <div ref={container} className="chat-challenge" aria-label="Human verification" />;
}
