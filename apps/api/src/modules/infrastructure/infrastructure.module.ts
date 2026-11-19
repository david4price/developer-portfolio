import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import type { Redis } from 'ioredis';
import { API_CONFIG, type ApiConfig, type InfrastructureConfig } from '../../config/api-config.js';
import { AI_PROVIDER, type AiProvider } from '../ai/ai-provider.js';
import { InfrastructureController } from './infrastructure.controller.js';
import {
  DisabledSnapshotSource,
  INFRASTRUCTURE_SNAPSHOTS,
  InfrastructureSnapshotService,
  type SnapshotSource,
} from './infrastructure-snapshot.service.js';
import { KubernetesClusterReader } from './kubernetes-cluster.reader.js';
import { ArgoCdApplicationReader } from './argocd-application.reader.js';
import { REDIS } from '../../redis/redis.module.js';
import {
  NoopTrafficCounter,
  RedisTrafficCounter,
  TRAFFIC_COUNTER,
  type TrafficCounter,
  TrafficInterceptor,
} from './traffic.js';

/**
 * The configured snapshot source; with the view off, one that reads nothing. The AI building
 * asks the chat's own adapter, when it is enabled and has a status check.
 */
export function createSnapshotSource(
  config: InfrastructureConfig,
  ai: AiProvider,
  traffic: TrafficCounter,
): SnapshotSource {
  if (!config.enabled) return new DisabledSnapshotSource();
  const reader = new KubernetesClusterReader({
    apiServerUrl: config.apiServerUrl,
    namespace: config.namespace,
  });
  const aiStatus = ai.enabled ? ai.status?.bind(ai) : undefined;
  return new InfrastructureSnapshotService(reader, {
    namespace: config.namespace,
    ...(aiStatus === undefined ? {} : { aiStatus }),
    traffic: (signal: AbortSignal) => traffic.read(signal),
    ...(config.argocd === undefined
      ? {}
      : {
          deploymentReader: new ArgoCdApplicationReader(config.argocd),
        }),
  });
}

/**
 * The Infrastructure Explorer's API (Phase 6). With `INFRASTRUCTURE_SOURCE=disabled` (the
 * default) nothing reads the cluster and the endpoint answers `infrastructure_disabled`.
 */
@Module({
  controllers: [InfrastructureController],
  providers: [
    {
      // Counting only runs while the view is on; with it off nothing is written to Redis.
      provide: TRAFFIC_COUNTER,
      inject: [API_CONFIG, REDIS],
      useFactory: (config: ApiConfig, redis: Redis): TrafficCounter =>
        config.infrastructure.enabled ? new RedisTrafficCounter(redis) : new NoopTrafficCounter(),
    },
    {
      provide: INFRASTRUCTURE_SNAPSHOTS,
      inject: [API_CONFIG, AI_PROVIDER, TRAFFIC_COUNTER],
      useFactory: (config: ApiConfig, ai: AiProvider, traffic: TrafficCounter) =>
        createSnapshotSource(config.infrastructure, ai, traffic),
    },
    {
      provide: APP_INTERCEPTOR,
      inject: [TRAFFIC_COUNTER],
      useFactory: (traffic: TrafficCounter) => new TrafficInterceptor(traffic),
    },
  ],
})
export class InfrastructureModule {}
