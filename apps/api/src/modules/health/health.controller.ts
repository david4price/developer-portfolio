import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { HealthResponse, ReadinessResponse } from '@portfolio/shared-types';
import type { FastifyReply } from 'fastify';
import { ApiMetrics } from '../../metrics/api-metrics.js';
import { evaluateReadiness, READINESS_CHECKS, type ReadinessCheck } from './readiness.js';

@Controller('health')
export class HealthController {
  constructor(
    @Inject(READINESS_CHECKS) private readonly checks: readonly ReadinessCheck[],
    private readonly metrics: ApiMetrics,
  ) {}

  /** Liveness: the process is serving requests. Never checks dependencies. */
  @Get()
  live(): HealthResponse {
    return { status: 'ok' };
  }

  /** Readiness: every required dependency answers. Returns 503 otherwise. */
  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessResponse> {
    const result = await evaluateReadiness(this.checks);
    this.metrics.setReadiness(result.checks);
    if (result.status !== 'ready') void reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
