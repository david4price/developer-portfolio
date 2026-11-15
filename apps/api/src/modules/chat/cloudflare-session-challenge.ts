import { CHAT_SESSION_CHALLENGE_ACTION } from '@portfolio/shared-types';
import { z } from 'zod';
import {
  ChallengeUnavailableError,
  type ChallengeVerdict,
  type SessionChallenge,
} from './session-challenge.js';

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

/** Siteverify error codes look like `timeout-or-duplicate`; anything else is not logged. */
const ERROR_CODE = /^[a-z0-9-]{1,40}$/;
const MAX_LOGGED_CODES = 5;

/** Success needs Cloudflare's yes plus this site's hostname and the chat action. */
function verdictOf(
  result: z.infer<typeof verificationSchema>,
  hostnames: readonly string[],
): ChallengeVerdict {
  if (!result.success) {
    const codes = (result['error-codes'] ?? []).filter((code) => ERROR_CODE.test(code));
    const reasons = codes.slice(0, MAX_LOGGED_CODES);
    return { verified: false, reasons: reasons.length > 0 ? reasons : ['unsuccessful'] };
  }
  const reasons: string[] = [];
  if (result.hostname === undefined || !hostnames.includes(result.hostname.toLowerCase())) {
    reasons.push('hostname-mismatch');
  }
  if (result.action !== CHAT_SESSION_CHALLENGE_ACTION) reasons.push('action-mismatch');
  return reasons.length === 0 ? { verified: true } : { verified: false, reasons };
}

/** Fixed HTTPS endpoint, no redirects, bounded response, and a deadline covering the body too. */
export class CloudflareSessionChallenge implements SessionChallenge {
  constructor(
    private readonly options: CloudflareChallengeOptions,
    private readonly fetchResponse: typeof fetch = fetch,
  ) {}

  async verify(token: string): Promise<ChallengeVerdict> {
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
      return verdictOf(result, this.options.hostnames);
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
