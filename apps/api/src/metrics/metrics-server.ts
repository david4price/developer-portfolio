import { once } from 'node:events';
import { createServer, type Server } from 'node:http';
import type { ApiMetrics } from './api-metrics.js';

export interface MetricsServerOptions {
  readonly host: string;
  readonly port: number;
}

/**
 * Serves `GET /metrics` on its own port, apart from the public API: the Service, the tunnel, and
 * the NetworkPolicies only know the API port, and by default it listens on loopback only, so it's
 * reached through `kubectl port-forward` (or a published loopback port in Compose). Everything
 * else is 404, and nothing a client sends reaches the registry.
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
  return server;
}
