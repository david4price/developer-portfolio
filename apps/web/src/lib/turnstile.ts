import { CHAT_SESSION_CHALLENGE_ACTION, CHALLENGE_TOKEN_MAX_LENGTH } from '@portfolio/shared-types';

export const TURNSTILE_SCRIPT =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

export interface TurnstileOptions {
  readonly sitekey: string;
  readonly action: string;
  readonly theme: 'auto';
  readonly size: 'compact';
  readonly 'response-field': false;
  readonly callback: (token: string) => void;
  readonly 'expired-callback': () => void;
  readonly 'error-callback': () => void;
  readonly 'timeout-callback': () => void;
}

export interface TurnstileApi {
  ready(callback: () => void): void;
  render(container: HTMLElement, options: TurnstileOptions): string;
  reset(id: string): void;
  remove(id: string): void;
}

export interface ChallengeEvents {
  readonly token: (token: string | null) => void;
  readonly unavailable: () => void;
}

/** Late callbacks after navigation or a consumed token cannot re-enable session creation. */
export function mountChallenge(
  api: TurnstileApi,
  container: HTMLElement,
  siteKey: string,
  events: ChallengeEvents,
): () => void {
  let active = true;
  let id: string | undefined;
  const expired = () => {
    if (!active) return;
    events.token(null);
    if (id !== undefined) api.reset(id);
  };
  api.ready(() => {
    if (!active) return;
    id = api.render(container, {
      sitekey: siteKey,
      action: CHAT_SESSION_CHALLENGE_ACTION,
      theme: 'auto',
      size: 'compact',
      'response-field': false,
      callback: (token) => {
        if (active)
          events.token(
            token.length > 0 && token.length <= CHALLENGE_TOKEN_MAX_LENGTH ? token : null,
          );
      },
      'expired-callback': expired,
      'timeout-callback': expired,
      'error-callback': () => {
        if (!active) return;
        events.token(null);
        events.unavailable();
      },
    });
  });
  return () => {
    active = false;
    if (id !== undefined) api.remove(id);
  };
}
