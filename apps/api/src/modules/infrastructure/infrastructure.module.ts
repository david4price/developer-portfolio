import { Module } from '@nestjs/common';
import { API_CONFIG, type ApiConfig, type InfrastructureConfig } from '../../config/api-config.js';
import { InfrastructureController } from './infrastructure.controller.js';
import {
  DisabledSnapshotSource,
  INFRASTRUCTURE_SNAPSHOTS,
  InfrastructureSnapshotService,
  type SnapshotSource,
} from './infrastructure-snapshot.service.js';
import { KubernetesClusterReader } from './kubernetes-cluster.reader.js';
import { ArgoCdApplicationReader } from './argocd-application.reader.js';

/** The configured snapshot source; with the view off, one that reads nothing. */
export function createSnapshotSource(config: InfrastructureConfig): SnapshotSource {
  if (!config.enabled) return new DisabledSnapshotSource();
  const reader = new KubernetesClusterReader({
    apiServerUrl: config.apiServerUrl,
    namespace: config.namespace,
  });
  return new InfrastructureSnapshotService(reader, {
    namespace: config.namespace,
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
      provide: INFRASTRUCTURE_SNAPSHOTS,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => createSnapshotSource(config.infrastructure),
    },
  ],
})
export class InfrastructureModule {}
