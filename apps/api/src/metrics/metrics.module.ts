import { Global, Module } from '@nestjs/common';
import { ApiMetrics } from './api-metrics.js';

/** One metrics registry for the whole API, injectable everywhere. */
@Global()
@Module({ providers: [ApiMetrics], exports: [ApiMetrics] })
export class MetricsModule {}
