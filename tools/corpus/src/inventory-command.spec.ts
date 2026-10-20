import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { corpusFileSchema } from '@antica/contracts';

import { canonicalJson } from './canonical.js';
import { createCorpusFixture } from './fixtures/corpus.js';
import { writeCorpusInventory } from './inventory-command.js';
import { createCorpusInventory, inventoryPath } from './inventory.js';

describe('fn: writeCorpusInventory', () => {
  it('should generate canonical evidence from directory inputs and reproduce it on subsequent runs', () => {
    const directory = mkdtempSync(join(tmpdir(), 'antica-inventory-test-'));
    try {
      const documents = createCorpusFixture();
      for (const document of documents) {
        const path = join(directory, document.path);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, document.text);
      }
      writeFileSync(join(directory, 'README.md'), 'Synthetic test corpus');
      const files = documents.map((document) =>
        corpusFileSchema.parse(JSON.parse(document.text)),
      );
      const expected = createCorpusInventory({
        entries: files.filter((file) => file.kind === 'entry'),
        sources: files.filter((file) => file.kind === 'source'),
      });
      writeCorpusInventory(directory);
      const first = readFileSync(join(directory, inventoryPath), 'utf8');
      expect(first).toBe(`${canonicalJson(expected)}\n`);
      writeCorpusInventory(directory);
      expect(readFileSync(join(directory, inventoryPath), 'utf8')).toBe(first);
      expect(
        documents.map((document) => ({
          path: document.path,
          text: readFileSync(join(directory, document.path), 'utf8'),
        })),
      ).toEqual(documents);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
