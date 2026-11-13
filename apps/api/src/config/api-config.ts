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

export interface ApiConfig {
  readonly environment: 'development' | 'test' | 'production';
  readonly host: string;
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  readonly corsOrigins: readonly string[];
  readonly ai: AiConfig;
}

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
  };
}
