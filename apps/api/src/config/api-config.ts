import {
  booleanFromEnv,
  connectionUrl,
  type LogLevel,
  logLevel,
  originList,
  parseEnvironment,
  portFromEnv,
} from '@portfolio/config';
import { z } from 'zod';

export const API_CONFIG = Symbol('API_CONFIG');

export const aiProviderNames = ['openai-compatible', 'ollama', 'openai', 'anthropic'] as const;
export type AiProviderName = (typeof aiProviderNames)[number];

export type AiConfig =
  | { readonly enabled: false }
  | {
      readonly enabled: true;
      readonly provider: AiProviderName;
      readonly model: string;
      readonly baseUrl: string | null;
    };

/** Abuse and capacity limits for the public chat (defaults follow docs/architecture/ai-integration.md). */
export interface ChatConfig {
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
}

const count = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

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
    AI_PROVIDER: z.enum(aiProviderNames).optional(),
    AI_MODEL: z.string().min(1).optional(),
    AI_BASE_URL: z.url().optional(),
    CHAT_AI_MAX_CONCURRENCY: count(1, 4).default(1),
    CHAT_AI_QUEUE_MAX: count(0, 20).default(4),
    CHAT_AI_QUEUE_WAIT_MS: count(0, 30_000).default(10_000),
    CHAT_SESSION_MESSAGE_LIMIT: count(1, 500).default(30),
    CHAT_IP_MESSAGES_PER_HOUR: count(1, 1_000).default(60),
    CHAT_IP_SESSIONS_PER_HOUR: count(1, 1_000).default(10),
    CHAT_TRUST_CF_CONNECTING_IP: booleanFromEnv.default(false),
  })
  .superRefine((environment, context) => {
    if (!environment.AI_ENABLED) return;
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
      maxConcurrency: parsed.CHAT_AI_MAX_CONCURRENCY,
      queueMax: parsed.CHAT_AI_QUEUE_MAX,
      queueWaitMs: parsed.CHAT_AI_QUEUE_WAIT_MS,
      sessionMessageLimit: parsed.CHAT_SESSION_MESSAGE_LIMIT,
      ipMessagesPerHour: parsed.CHAT_IP_MESSAGES_PER_HOUR,
      ipSessionsPerHour: parsed.CHAT_IP_SESSIONS_PER_HOUR,
      trustCfConnectingIp: parsed.CHAT_TRUST_CF_CONNECTING_IP,
    },
  };
}
