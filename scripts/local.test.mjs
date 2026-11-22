// Unit tests for the local-development helpers (P8-01). Run: node --test scripts/local.test.mjs
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeProject, otherServices, parseEnv, portMismatches } from './lib/local.mjs';

const urls = {
  DATABASE_URL: 'postgres://portfolio:secret@localhost:5432/portfolio',
  REDIS_URL: 'redis://localhost:6379',
};

describe('local helpers', () => {
  it('reads .env values as Compose does: quotes, an export prefix, inline comments', () => {
    assert.deepEqual(
      parseEnv(
        [
          '# a comment',
          'A=1',
          'export B="2"',
          "C='3'",
          'D=5433 # moved',
          'E="postgres://x:y@h:1/d" # local',
          'F="a # not a comment"',
          'G=',
        ].join('\n'),
      ),
      {
        A: '1',
        B: '2',
        C: '3',
        D: '5433',
        E: 'postgres://x:y@h:1/d',
        F: 'a # not a comment',
        G: '',
      },
    );
  });

  it('accepts URLs that match the published ports, defaults and empty values included', () => {
    assert.deepEqual(portMismatches(urls), []);
    assert.deepEqual(portMismatches({ ...urls, POSTGRES_PORT: '', REDIS_PORT: '6379' }), []);
    assert.deepEqual(
      portMismatches({
        DATABASE_URL: 'postgres://p:s@127.0.0.1:5433/p',
        REDIS_URL: 'redis://localhost:6380',
        POSTGRES_PORT: '5433',
        REDIS_PORT: '6380',
      }),
      [],
    );
    // Not local: Compose's ports don't apply.
    assert.deepEqual(
      portMismatches({
        ...urls,
        DATABASE_URL: 'postgres://db.example:5432/p',
        POSTGRES_PORT: '5433',
      }),
      [],
    );
  });

  it('names a mismatch, a missing URL, and an invalid one', () => {
    assert.match(
      portMismatches({ ...urls, POSTGRES_PORT: '5433' }).join(),
      /DATABASE_URL uses port 5432 but POSTGRES_PORT is 5433/,
    );
    assert.match(
      portMismatches({ DATABASE_URL: urls.DATABASE_URL }).join(),
      /REDIS_URL is missing/,
    );
    assert.match(
      portMismatches({ ...urls, REDIS_URL: 'not a url' }).join(),
      /REDIS_URL in \.env is not a valid URL/,
    );
  });

  it('finds services other than PostgreSQL and Redis, once each', () => {
    assert.deepEqual(otherServices('postgres\nredis\n'), []);
    assert.deepEqual(otherServices('postgres\napi\nweb\napi\n'), ['api', 'web']);
    assert.deepEqual(otherServices(''), []);
  });

  it('normalizes a project name as Compose does', () => {
    assert.equal(normalizeProject('MyFolio'), 'myfolio');
    assert.equal(normalizeProject('-My Folio!'), 'myfolio');
  });
});
