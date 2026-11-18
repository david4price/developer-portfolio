import { Module } from '@nestjs/common';
import { API_CONFIG, type ApiConfig, type InfrastructureConfig } from '../../config/api-config.js';
import { CLUSTER_READER, type ClusterReader } from './cluster-reader.js';
import { InfrastructureController } from './infrastructure.controller.js';
import {
  INFRASTRUCTURE_SNAPSHOTS,
  InfrastructureSnapshotService,
} from './infrastructure-snapshot.service.js';
import { KubernetesClusterReader } from './kubernetes-cluster.reader.js';

/** The configured cluster reader, or `null` when the infrastructure view is off. */
export function createClusterReader(config: InfrastructureConfig): ClusterReader | null {
  if (!config.enabled) return null;
  return new KubernetesClusterReader({
    apiServerUrl: config.apiServerUrl,
    namespace: config.namespace,
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
      provide: CLUSTER_READER,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig) => createClusterReader(config.infrastructure),
    },
    {
      provide: INFRASTRUCTURE_SNAPSHOTS,
      inject: [API_CONFIG, CLUSTER_READER],
      useFactory: (config: ApiConfig, reader: ClusterReader | null) =>
        reader === null || !config.infrastructure.enabled
          ? null
          : new InfrastructureSnapshotService(reader, {
              namespace: config.infrastructure.namespace,
            }),
    },
  ],
})
export class InfrastructureModule {}
