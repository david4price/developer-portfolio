import { randomBytes } from 'node:crypto';
import { API_PREFIX } from '@portfolio/shared-types';

export const CHAT_COOKIE_NAME = 'portfolio_chat';
/** Sent only to the chat routes, never to the rest of the API. */
export const CHAT_COOKIE_PATH = `/${API_PREFIX}/chat`;

/** 32 random bytes, base64url: 43 characters, 256 bits. */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function newSessionId(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Returns the chat session ID from a `Cookie` header, or `undefined` when it is absent or not
 * exactly the shape this server issues. Nothing else from the header is ever used.
 */
export function sessionIdFromCookieHeader(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;
    if (pair.slice(0, separator).trim() !== CHAT_COOKIE_NAME) continue;
    const value = pair.slice(separator + 1).trim();
    return SESSION_ID_PATTERN.test(value) ? value : undefined;
  }
  return undefined;
}

export function sessionCookie(sessionId: string, maxAgeSeconds: number): string {
  return [
    `${CHAT_COOKIE_NAME}=${sessionId}`,
    `Path=${CHAT_COOKIE_PATH}`,
    `Max-Age=${maxAgeSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ].join('; ');
}
