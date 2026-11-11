import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import pg from 'pg';
import { API_CONFIG, type ApiConfig } from '../config/api-config.js';
import type { ReadinessCheck } from '../modules/health/readiness.js';
import { createDatabase, createPool } from './database.js';

export const PG_POOL = Symbol('PG_POOL');
export const DATABASE = Symbol('DATABASE');
export const POSTGRES_READINESS = Symbol('POSTGRES_READINESS');

@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      inject: [API_CONFIG],
      useFactory: (config: ApiConfig): pg.Pool => {
        const pool = createPool(config.databaseUrl);
        const logger = new Logger('PostgreSQL');
        // Idle-client errors (e.g. a database restart) must not crash the process.
        pool.on('error', (error) =>
          logger.warn({ message: 'idle client error', error: error.message }),
        );
        return pool;
      },
    },
    { provide: DATABASE, inject: [PG_POOL], useFactory: createDatabase },
    {
      provide: POSTGRES_READINESS,
      inject: [PG_POOL],
      useFactory: (pool: pg.Pool): ReadinessCheck => ({
        name: 'postgres',
        check: async () => {
          await pool.query('SELECT 1');
        },
      }),
    },
  ],
  exports: [DATABASE, POSTGRES_READINESS],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: pg.Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
