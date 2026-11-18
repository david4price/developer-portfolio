import { Controller, Get, Header, HttpStatus, Inject } from '@nestjs/common';
import type { InfrastructureSnapshot } from '@portfolio/shared-types';
import { ApiException } from '../../common/api-exception.js';
import {
  INFRASTRUCTURE_SNAPSHOTS,
  type InfrastructureSnapshotService,
  InfrastructureUnavailableError,
} from './infrastructure-snapshot.service.js';

/**
 * The Infrastructure Explorer's snapshot: allowlisted fields only, cached on the server. Off by
 * default (`503 infrastructure_disabled`); `503 infrastructure_unavailable` when the cluster
 * can't be read and there is no earlier snapshot.
 */
@Controller('infrastructure')
export class InfrastructureController {
  constructor(
    @Inject(INFRASTRUCTURE_SNAPSHOTS)
    private readonly snapshots: InfrastructureSnapshotService | null,
  ) {}

  @Get()
  // The page judges freshness itself; a cached copy anywhere else would only hide staleness.
  @Header('Cache-Control', 'no-store')
  async get(): Promise<InfrastructureSnapshot> {
    if (this.snapshots === null) {
      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'infrastructure_disabled',
        'The infrastructure view is not enabled on this deployment.',
      );
    }
    try {
      return await this.snapshots.snapshot();
    } catch (error) {
      if (error instanceof InfrastructureUnavailableError) {
        throw new ApiException(
          HttpStatus.SERVICE_UNAVAILABLE,
          'infrastructure_unavailable',
          'The infrastructure status is unavailable right now.',
        );
      }
      throw error;
    }
  }
}
