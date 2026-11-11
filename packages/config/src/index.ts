import { z } from 'zod';

/** Accepts only the literal strings `true` and `false`; anything else fails validation. */
export const booleanFromEnv = z.preprocess((value) => {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean());

export const portFromEnv = z.coerce.number().int().min(1).max(65_535);

export const logLevel = z.enum(['error', 'warn', 'log', 'debug', 'verbose']);
export type LogLevel = z.infer<typeof logLevel>;

const logSeverity = ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'] as const;

/** `level` and every more severe level, in the shape Nest's `logLevels` option expects. */
export function logLevelsUpTo(level: LogLevel): (typeof logSeverity)[number][] {
  return logSeverity.slice(0, logSeverity.indexOf(level) + 1);
}

/** A connection URL whose scheme is one of `protocols`, e.g. `postgres:` or `redis:`. */
export function connectionUrl(...protocols: readonly string[]) {
  return z.url().refine((value) => protocols.includes(new URL(value).protocol), {
    message: `must use one of the protocols: ${protocols.join(', ')}`,
  });
}

/** A comma-separated list of exact http(s) origins (scheme + host + optional port, no path). */
export const originList = z
  .string()
  .optional()
  .transform((value, context): readonly string[] => {
    if (!value?.trim()) return [];

    const origins = value.split(',').map((origin) => origin.trim());
    for (const origin of origins) {
      let parsed: URL;
      try {
        parsed = new URL(origin);
      } catch {
        context.addIssue({ code: 'custom', message: `invalid origin: ${origin}` });
        return z.NEVER;
      }
      if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) {
        context.addIssue({
          code: 'custom',
          message: `must be an exact http(s) origin without path or trailing slash: ${origin}`,
        });
        return z.NEVER;
      }
    }

    return origins;
  });

export class EnvironmentValidationError extends Error {
  constructor(readonly issues: readonly string[]) {
    super(`Invalid environment:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'EnvironmentValidationError';
  }
}

/**
 * Parses an environment with a schema. Error messages name the offending variables but never
 * echo their values, so secrets cannot leak into logs.
 */
export function parseEnvironment<Schema extends z.ZodType>(
  schema: Schema,
  environment: Readonly<Record<string, string | undefined>>,
): z.infer<Schema> {
  const result = schema.safeParse(environment);
  if (result.success) return result.data;

  throw new EnvironmentValidationError(
    result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
  );
}
