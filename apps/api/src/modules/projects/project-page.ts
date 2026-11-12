import { slug as slugSchema } from '@portfolio/project-registry';
import { PROJECT_PAGE_DEFAULT_LIMIT, PROJECT_PAGE_MAX_LIMIT } from '@portfolio/shared-types';
import { z } from 'zod';

/**
 * A project's place in the list order (featured first, then title, then slug). The slug makes the
 * order total, so keyset pages never skip or repeat a project.
 */
export interface ProjectPosition {
  readonly featured: boolean;
  readonly title: string;
  readonly slug: string;
}

const MAX_CURSOR_LENGTH = 512;

const positionSchema = z.strictObject({
  f: z.boolean(),
  t: z.string().min(1).max(80),
  s: slugSchema,
});

/** Encodes a position as an opaque, URL-safe cursor. */
export function encodeProjectCursor(position: ProjectPosition): string {
  const payload: z.infer<typeof positionSchema> = {
    f: position.featured,
    t: position.title,
    s: position.slug,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeProjectCursor(cursor: string): ProjectPosition | undefined {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  const result = positionSchema.safeParse(json);
  if (!result.success) return undefined;
  return { featured: result.data.f, title: result.data.t, slug: result.data.s };
}

const cursorSchema = z
  .string()
  .max(MAX_CURSOR_LENGTH)
  .regex(/^[A-Za-z0-9_-]+$/, 'invalid cursor')
  .transform((cursor, context) => {
    const position = decodeProjectCursor(cursor);
    if (position === undefined) {
      context.addIssue({ code: 'custom', message: 'invalid cursor' });
      return z.NEVER;
    }
    return position;
  });

/** Query string of `GET /api/v1/projects`. */
export const listProjectsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(PROJECT_PAGE_MAX_LIMIT)
    .default(PROJECT_PAGE_DEFAULT_LIMIT),
  cursor: cursorSchema.optional(),
});

export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
