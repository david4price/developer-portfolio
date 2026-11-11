import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { Logger } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { API_PREFIX } from '@portfolio/shared-types';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import type { ApiConfig } from './config/api-config.js';

const requestIdPattern = /^[A-Za-z0-9._-]{1,64}$/;
const BODY_LIMIT_BYTES = 16 * 1024;

/** Reuses a well-formed incoming `x-request-id`; otherwise generates one. */
export function requestIdFor(request: IncomingMessage): string {
  const incoming = request.headers['x-request-id'];
  return typeof incoming === 'string' && requestIdPattern.test(incoming) ? incoming : randomUUID();
}

export function createFastifyAdapter(): FastifyAdapter {
  return new FastifyAdapter({
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: requestIdFor,
    logger: false,
    trustProxy: false,
  });
}

/** Applies HTTP behavior shared by `main.ts` and tests: prefix, CORS, headers, errors, logs. */
export function configureApp(
  app: NestFastifyApplication,
  config: Pick<ApiConfig, 'corsOrigins'>,
): void {
  app.setGlobalPrefix(API_PREFIX);
  app.useGlobalFilters(new ApiExceptionFilter());
  app.enableCors({
    origin: [...config.corsOrigins],
    methods: ['GET', 'POST'],
    credentials: true,
    maxAge: 600,
  });

  const fastify = app.getHttpAdapter().getInstance();
  const accessLog = new Logger('HTTP');

  fastify.addHook('onSend', async (request, reply) => {
    void reply
      .header('x-request-id', request.id)
      .header('x-content-type-options', 'nosniff')
      .header('x-frame-options', 'DENY')
      .header('referrer-policy', 'no-referrer')
      .header('cache-control', 'no-store');
  });

  fastify.addHook('onResponse', async (request, reply) => {
    accessLog.log({
      message: 'request completed',
      requestId: request.id,
      method: request.method,
      route: request.routeOptions.url ?? 'unmatched',
      status: reply.statusCode,
      durationMs: Math.round(reply.elapsedTime),
    });
  });
}
