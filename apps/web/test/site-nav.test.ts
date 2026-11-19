import assert from 'node:assert/strict';
import { it } from 'node:test';
import { isCurrent } from '../src/lib/nav.js';

it('marks the current section: home only on itself, others on themselves and below', () => {
  assert.equal(isCurrent('/', '/'), true);
  assert.equal(isCurrent('/', '/about/'), false);
  assert.equal(isCurrent('/about/', '/about/'), true);
  assert.equal(isCurrent('/about/', '/about'), true, 'with or without the trailing slash');
  assert.equal(isCurrent('/projects/', '/projects/developer-portfolio/'), true);
  assert.equal(isCurrent('/projects/', '/projectsx/'), false, 'not a prefix of another name');
  assert.equal(isCurrent('/experience/', '/about/'), false);
});
