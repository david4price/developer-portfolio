import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { z } from 'zod';
import {
  booleanFromEnv,
  connectionUrl,
  EnvironmentValidationError,
  logLevelsUpTo,
  originList,
  parseEnvironment,
} from '../src/index.js';

describe('booleanFromEnv', () => {
  it('accepts only literal true and false', () => {
    assert.equal(booleanFromEnv.parse('true'), true);
    assert.equal(booleanFromEnv.parse('false'), false);
    assert.equal(booleanFromEnv.safeParse('1').success, false);
    assert.equal(booleanFromEnv.safeParse('yes').success, false);
  });
});

describe('logLevelsUpTo', () => {
  it('includes the level and everything more severe', () => {
    assert.deepEqual(logLevelsUpTo('warn'), ['fatal', 'error', 'warn']);
    assert.deepEqual(logLevelsUpTo('verbose').length, 6);
  });
});

describe('connectionUrl', () => {
  it('restricts the URL scheme', () => {
    const postgres = connectionUrl('postgres:', 'postgresql:');
    assert.equal(postgres.safeParse('postgres://user:pw@db:5432/app').success, true);
    assert.equal(postgres.safeParse('redis://cache:6379').success, false);
  });
});

describe('originList', () => {
  it('parses a comma-separated list of exact origins', () => {
    assert.deepEqual(originList.parse('http://localhost:3000, https://example.com'), [
      'http://localhost:3000',
      'https://example.com',
    ]);
    assert.deepEqual(originList.parse(undefined), []);
  });

  it('rejects paths, trailing slashes, and non-http schemes', () => {
    assert.equal(originList.safeParse('https://example.com/').success, false);
    assert.equal(originList.safeParse('https://example.com/app').success, false);
    assert.equal(originList.safeParse('ftp://example.com').success, false);
  });
});

describe('parseEnvironment', () => {
  const schema = z.object({ DATABASE_URL: connectionUrl('postgres:') });

  it('names missing variables without echoing values', () => {
    assert.throws(
      () => parseEnvironment(schema, { DATABASE_URL: 'mysql://secret-password@db/app' }),
      (error: unknown) => {
        assert.ok(error instanceof EnvironmentValidationError);
        assert.match(error.message, /DATABASE_URL/);
        assert.doesNotMatch(error.message, /secret-password/);
        return true;
      },
    );
  });
});
