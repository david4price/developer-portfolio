import { CHAT_SESSION_CHALLENGE_ACTION } from '@portfolio/shared-types';
import { z } from 'zod';
import { ChallengeUnavailableError, type SessionChallenge } from './session-challenge.js';

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const MAX_RESPONSE_BYTES = 8_192;
const verificationSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  'error-codes': z.array(z.string()).optional(),
});
const configurationErrors = new Set([
  'missing-input-secret',
  'invalid-input-secret',
  'internal-error',
]);

export interface CloudflareChallengeOptions {
  readonly secretKey: string;
  readonly hostnames: readonly string[];
  readonly timeoutMs?: number;
}

/** Fixed HTTPS endpoint, no redirects, bounded response, and a deadline covering the body too. */
export class CloudflareSessionChallenge implements SessionChallenge {
  constructor(
    private readonly options: CloudflareChallengeOptions,
    private readonly fetchResponse: typeof fetch = fetch,
  ) {}

  async verify(token: string): Promise<boolean> {
    try {
      const response = await this.fetchResponse(SITEVERIFY_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ secret: this.options.secretKey, response: token }),
        redirect: 'error',
        signal: AbortSignal.timeout(this.options.timeoutMs ?? 5_000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ChallengeUnavailableError();
      }
      const parsed = verificationSchema.safeParse(await this.readJson(response));
      if (!parsed.success) throw new ChallengeUnavailableError();
      const result = parsed.data;
      if (result['error-codes']?.some((code) => configurationErrors.has(code))) {
        throw new ChallengeUnavailableError();
      }
      return (
        result.success &&
        result.hostname !== undefined &&
        this.options.hostnames.includes(result.hostname.toLowerCase()) &&
        result.action === CHAT_SESSION_CHALLENGE_ACTION
      );
    } catch {
      // Never expose tokens, secrets, upstream bodies, or network errors to callers or logs.
      throw new ChallengeUnavailableError();
    }
  }

  private async readJson(response: Response): Promise<unknown> {
    if (Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES) {
      await response.body?.cancel();
      throw new ChallengeUnavailableError();
    }
    if (response.body === null) throw new ChallengeUnavailableError();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new ChallengeUnavailableError();
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }
}
