import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDocNotes,
  docNotes,
  docNoteUrl,
  type DocNotesInput,
  findDocNote,
} from '../src/index.js';

/** Tests run from `.test-dist/test/`, four levels below the repository root. */
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const note: DocNotesInput['notes'][number] = {
  slug: 'example',
  title: 'Example note',
  keywords: ['example'],
  text: 'How the example works.',
  source: 'docs/example.md',
};
const validNotes: DocNotesInput = {
  repositoryUrl: 'https://github.com/example/repo',
  branch: 'main',
  notes: [note],
};

describe('shipped doc notes', () => {
  it('are valid and non-empty', () => {
    assert.ok(docNotes.notes.length > 0);
  });

  it('link to files and folders that exist in this repository', () => {
    for (const { slug, source } of docNotes.notes) {
      const path = join(repositoryRoot, source);
      assert.ok(existsSync(path), `${slug}: ${source} does not exist`);
      assert.equal(
        statSync(path).isDirectory(),
        source.endsWith('/'),
        `${slug}: folders end with / and files don't`,
      );
    }
  });

  it('find notes by slug only', () => {
    const first = docNotes.notes[0];
    assert.ok(first);
    assert.equal(findDocNote(first.slug)?.slug, first.slug);
    assert.equal(findDocNote('does-not-exist'), undefined);
  });
});

describe('docNoteUrl', () => {
  const notes = createDocNotes(validNotes);

  it('opens files as blobs and folders as trees on the configured branch', () => {
    assert.equal(
      docNoteUrl({ ...note, source: 'docs/example.md' }, notes),
      'https://github.com/example/repo/blob/main/docs/example.md',
    );
    assert.equal(
      docNoteUrl({ ...note, source: 'apps/api/src/' }, notes),
      'https://github.com/example/repo/tree/main/apps/api/src/',
    );
  });
});

describe('createDocNotes', () => {
  it('accepts valid notes unchanged', () => {
    assert.deepEqual(createDocNotes(validNotes), validNotes);
  });

  it('rejects sources that leave the repository or are not relative', () => {
    for (const source of ['../secrets.md', 'docs/../../x', './docs/a.md', '/etc/passwd', 'a//b']) {
      assert.throws(
        () => createDocNotes({ ...validNotes, notes: [{ ...note, source }] }),
        /must/,
        source,
      );
    }
    assert.throws(() =>
      createDocNotes({ ...validNotes, notes: [{ ...note, source: 'https://evil.example/' }] }),
    );
  });

  it('requires an https repository URL without a trailing slash, and a plain branch name', () => {
    assert.throws(() => createDocNotes({ ...validNotes, repositoryUrl: 'http://github.com/a/b' }));
    assert.throws(() =>
      createDocNotes({ ...validNotes, repositoryUrl: 'https://github.com/a/b/' }),
    );
    assert.throws(() => createDocNotes({ ...validNotes, branch: 'main?x=1' }));
  });

  it('rejects prompt control markup and hidden text, as the registry does', () => {
    assert.throws(
      () => createDocNotes({ ...validNotes, notes: [{ ...note, text: 'See [INST] here' }] }),
      /prompt control markup/,
    );
    assert.throws(
      () => createDocNotes({ ...validNotes, notes: [{ ...note, keywords: ['k\u202Ey'] }] }),
      /hidden text/,
    );
  });

  it('rejects duplicate slugs and titles', () => {
    assert.throws(
      () => createDocNotes({ ...validNotes, notes: [note, { ...note, title: 'Other' }] }),
      /duplicate doc note slug: example/,
    );
    assert.throws(
      () =>
        createDocNotes({
          ...validNotes,
          notes: [note, { ...note, slug: 'other', title: 'EXAMPLE NOTE' }],
        }),
      /duplicate doc note title: example note/,
    );
  });
});
