import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EnvironmentValidationError } from '@portfolio/config';
import { loadApiConfig } from '../src/config/api-config.js';

const required = {
  DATABASE_URL: 'postgres://portfolio:local-only@localhost:5432/portfolio',
  REDIS_URL: 'redis://localhost:6379',
};

describe('loadApiConfig', () => {
  it('applies safe non-secret defaults', () => {
    const config = loadApiConfig(required);
    assert.equal(config.port, 3001);
    assert.equal(config.environment, 'development');
    assert.deepEqual(config.corsOrigins, []);
    assert.deepEqual(config.ai, { enabled: false });
  });

  it('rejects a missing database URL without echoing other values', () => {
    assert.throws(
      () => loadApiConfig({ REDIS_URL: required.REDIS_URL }),
      (error: unknown) => {
        assert.ok(error instanceof EnvironmentValidationError);
        assert.match(error.message, /DATABASE_URL/);
        assert.doesNotMatch(error.message, /localhost:6379/);
        return true;
      },
    );
  });

  it('rejects a database URL with the wrong scheme', () => {
    assert.throws(
      () => loadApiConfig({ ...required, DATABASE_URL: 'mysql://db/portfolio' }),
      /DATABASE_URL/,
    );
  });

  it('requires provider and model when AI is enabled', () => {
    assert.throws(
      () => loadApiConfig({ ...required, AI_ENABLED: 'true' }),
      /AI_PROVIDER[\s\S]*AI_MODEL/,
    );
  });

  it('parses an enabled AI configuration', () => {
    const config = loadApiConfig({
      ...required,
      AI_ENABLED: 'true',
      AI_PROVIDER: 'openai-compatible',
      AI_MODEL: 'example-model',
      AI_BASE_URL: 'http://inference.internal:8000/v1',
    });
    assert.deepEqual(config.ai, {
      enabled: true,
      provider: 'openai-compatible',
      model: 'example-model',
      baseUrl: 'http://inference.internal:8000/v1',
    });
  });

  it('rejects ambiguous boolean values', () => {
    assert.throws(() => loadApiConfig({ ...required, AI_ENABLED: 'yes' }), /AI_ENABLED/);
  });
});
