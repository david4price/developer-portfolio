import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import { Logger } from '@nestjs/common';
import type { ApiMetrics } from './api-metrics.js';

export interface MetricsServerOptions {
  readonly host: string;
  readonly port: number;
}

/**
 * Serves `GET /metrics` on its own port, apart from the public API: the Service and the tunnel
 * only know the API port. By default it listens on loopback only, so it's reached through `kubectl port-forward` (or a
 * published loopback port in Compose). With scraping on (P9-04) it listens on every pod interface,
 * and one NetworkPolicy rule opens the pod IP to Prometheus alone. Everything else is 404, and
 * nothing a client sends reaches the registry.
 */
export async function startMetricsServer(
  metrics: ApiMetrics,
  options: MetricsServerOptions,
): Promise<Server> {
  const server = createServer((request, response) => {
    const path = (request.url ?? '').split('?', 1)[0];
    if (path !== '/metrics' || (request.method !== 'GET' && request.method !== 'HEAD')) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not Found\n');
      return;
    }
    metrics.render().then(
      (body) => {
        response.writeHead(200, {
          'content-type': metrics.contentType,
          'cache-control': 'no-store',
        });
        response.end(request.method === 'HEAD' ? undefined : body);
      },
      () => {
        response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }).end('Error\n');
      },
    );
  });
  server.listen(options.port, options.host);
  await once(server, 'listening');
  // After startup, a server error (e.g. accept failing with EMFILE) is logged, never thrown: the
  // metrics port must not be able to take the API down.
  const logger = new Logger('MetricsServer');
  server.on('error', (error) =>
    logger.error({ message: 'metrics server error', error: error.message }),
  );
  return server;
}

/** Stops listening and drops open connections. Safe to call more than once. */
export async function closeMetricsServer(server: Server): Promise<void> {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
