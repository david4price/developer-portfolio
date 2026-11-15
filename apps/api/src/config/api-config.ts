import {
  booleanFromEnv,
  connectionUrl,
  type LogLevel,
  logLevel,
  originList,
  parseEnvironment,
  portFromEnv,
} from '@portfolio/config';
import { ASSISTANT_NAME_PATTERN, DEFAULT_ASSISTANT_NAME } from '@portfolio/shared-types';
import { z } from 'zod';

export const API_CONFIG = Symbol('API_CONFIG');

export const aiProviderNames = ['openai-compatible', 'ollama', 'openai', 'anthropic'] as const;
export type AiProviderName = (typeof aiProviderNames)[number];

export const messageGuardNames = ['rules', 'classifier'] as const;

/**
 * How visitor messages are screened (P5-08). `classifier` runs the rules, then a CPU injection
 * classifier loaded from `modelDir`; it needs about 650 MiB more memory than `rules`. With AI off
 * no message reaches screening, so the guard is always `rules` and no model is loaded.
 */
export type MessageGuardConfig =
  | { readonly kind: 'rules' }
  | {
      readonly kind: 'classifier';
      readonly modelDir: string;
      readonly threshold: number;
      readonly timeoutMs: number;
    };

export type AiConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly provider: AiProviderName;
      readonly model: string;
      readonly baseUrl: string | null;
    };

/**
 * The public chat's abuse and capacity limits (defaults follow docs/architecture/ai-integration.md)
 * and the name its assistant speaks under.
 */
export interface ChatConfig {
  /** The dog companion's name in the system prompt. Letters, spaces, hyphens, apostrophes. */
  readonly assistantName: string;
  /** AI calls in flight across all API replicas. */
  readonly maxConcurrency: number;
  /** Requests allowed to wait for a slot; more are rejected at once. */
  readonly queueMax: number;
  /** Longest a request waits for a slot before `503 ai_overloaded`. */
  readonly queueWaitMs: number;
  readonly sessionMessageLimit: number;
  readonly ipMessagesPerHour: number;
  readonly ipSessionsPerHour: number;
  /**
   * Use `CF-Connecting-IP` as the client address. Only safe when every request provably comes
   * through the Cloudflare tunnel (a NetworkPolicy admits only cloudflared); otherwise anyone
   * could pick their own quota bucket.
   */
  readonly trustCfConnectingIp: boolean;
  readonly guard: MessageGuardConfig;
}

export interface ApiConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly corsOrigins: readonly string[];
  readonly ai: AiConfig;
  readonly chat: ChatConfig;
  readonly turnstile:
    | { readonly enabled: false }
    | { readonly enabled: true; readonly secretKey: string; readonly hostnames: readonly string[] };
}

const count = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
/** Compose passes unset optional settings as empty strings. Required enabled settings still fail. */
const optionalSetting = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
  );
/**
 * Interpolated into the system prompt, so only a plain name: no digits, markup, or punctuation.
 * Blank means unset (as in the web build), and composed (NFC) form means a decomposed accent
 * isn't rejected as a non-letter.
 */
const assistantName = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim().normalize('NFC') || undefined : value),
  z
    .string()
    .regex(ASSISTANT_NAME_PATTERN, 'must be 1-30 letters, spaces, hyphens, or apostrophes')
    .optional(),
);
const hostnames = z
  .string()
  .transform((value) => value.split(','))
  .pipe(z.array(hostname).min(1));

const apiEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    API_PORT: portFromEnv.default(3001),
    LOG_LEVEL: logLevel.default('log'),
    DATABASE_URL: connectionUrl('postgres:', 'postgresql:'),
    REDIS_URL: connectionUrl('redis:', 'rediss:'),
    CORS_ORIGINS: originList,
    AI_ENABLED: booleanFromEnv.default(false),
    AI_PROVIDER: optionalSetting(z.enum(aiProviderNames)),
    AI_MODEL: optionalSetting(z.string().min(1)),
    AI_BASE_URL: optionalSetting(z.url()),
    TURNSTILE_SECRET_KEY: optionalSetting(z.string().trim().min(1)),
    TURNSTILE_HOSTNAMES: optionalSetting(hostnames),
    CHAT_ASSISTANT_NAME: assistantName,
    CHAT_AI_MAX_CONCURRENCY: count(1, 4).default(1),
    CHAT_AI_QUEUE_MAX: count(0, 20).default(4),
    CHAT_AI_QUEUE_WAIT_MS: count(0, 30_000).default(10_000),
    CHAT_SESSION_MESSAGE_LIMIT: count(1, 500).default(30),
    CHAT_IP_MESSAGES_PER_HOUR: count(1, 1_000).default(60),
    CHAT_IP_SESSIONS_PER_HOUR: count(1, 1_000).default(10),
    CHAT_TRUST_CF_CONNECTING_IP: booleanFromEnv.default(false),
    CHAT_GUARD: z.enum(messageGuardNames).default('rules'),
    CHAT_GUARD_MODEL_DIR: z.string().trim().min(1).default('models/injection-classifier'),
    CHAT_GUARD_THRESHOLD: z.coerce.number().gt(0).max(1).default(0.5),
    CHAT_GUARD_TIMEOUT_MS: count(50, 10_000).default(2_000),
  })
  .superRefine((environment, context) => {
    if (!environment.AI_ENABLED) return;
    for (const key of ['TURNSTILE_SECRET_KEY', 'TURNSTILE_HOSTNAMES'] as const) {
      if (environment[key] === undefined) {
        context.addIssue({ code: 'custom', path: [key], message: 'required when AI_ENABLED=true' });
      }
    }
    if (environment.AI_PROVIDER === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['AI_PROVIDER'],
        message: 'required when AI_ENABLED=true',
      });
    }
    if (environment.AI_MODEL === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['AI_MODEL'],
        message: 'required when AI_ENABLED=true',
      });
    }
    if (environment.AI_PROVIDER === 'openai-compatible') {
      const baseUrl = environment.AI_BASE_URL;
      if (baseUrl === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['AI_BASE_URL'],
          message: 'required when AI_PROVIDER=openai-compatible',
        });
      } else if (!/^https?:$/.test(new URL(baseUrl).protocol)) {
        context.addIssue({ code: 'custom', path: ['AI_BASE_URL'], message: 'must be http(s)' });
      }
    }
  });

export function loadApiConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): ApiConfig {
  const parsed = parseEnvironment(apiEnvironmentSchema, environment);

  return {
    environment: parsed.NODE_ENV,
    host: parsed.API_HOST,
    port: parsed.API_PORT,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    corsOrigins: parsed.CORS_ORIGINS,
    ai:
      parsed.AI_ENABLED && parsed.AI_PROVIDER !== undefined && parsed.AI_MODEL !== undefined
        ? {
            enabled: true,
            provider: parsed.AI_PROVIDER,
            model: parsed.AI_MODEL,
            baseUrl: parsed.AI_BASE_URL ?? null,
          }
        : { enabled: false },
    chat: {
      assistantName: parsed.CHAT_ASSISTANT_NAME ?? DEFAULT_ASSISTANT_NAME,
      maxConcurrency: parsed.CHAT_AI_MAX_CONCURRENCY,
      queueMax: parsed.CHAT_AI_QUEUE_MAX,
      queueWaitMs: parsed.CHAT_AI_QUEUE_WAIT_MS,
      sessionMessageLimit: parsed.CHAT_SESSION_MESSAGE_LIMIT,
      ipMessagesPerHour: parsed.CHAT_IP_MESSAGES_PER_HOUR,
      ipSessionsPerHour: parsed.CHAT_IP_SESSIONS_PER_HOUR,
      trustCfConnectingIp: parsed.CHAT_TRUST_CF_CONNECTING_IP,
      guard:
        parsed.CHAT_GUARD === 'classifier' && parsed.AI_ENABLED
          ? {
              kind: 'classifier',
              modelDir: parsed.CHAT_GUARD_MODEL_DIR,
              threshold: parsed.CHAT_GUARD_THRESHOLD,
              timeoutMs: parsed.CHAT_GUARD_TIMEOUT_MS,
            }
          : { kind: 'rules' },
    },
    turnstile:
      parsed.AI_ENABLED &&
      parsed.TURNSTILE_SECRET_KEY !== undefined &&
      parsed.TURNSTILE_HOSTNAMES !== undefined
        ? {
            enabled: true,
            secretKey: parsed.TURNSTILE_SECRET_KEY,
            hostnames: parsed.TURNSTILE_HOSTNAMES,
          }
        : { enabled: false },
  };
}
