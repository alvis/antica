import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { corpusFileSchema } from '@antica/contracts';

import { canonicalJson } from './canonical.js';
import { readCorpusDirectory } from './cli.js';
import { createCorpusInventory, inventoryPath } from './inventory.js';

/**
 * regenerates the captured inventory without modifying release manifests or claims
 * @param directory corpus directory, defaulting to the checked-in Antica corpus
 */
export function writeCorpusInventory(
  directory = fileURLToPath(
    new URL('../../../corpus/antica/v1', import.meta.url),
  ),
): void {
  const files = readCorpusDirectory(directory)
    .filter((document) => document.path.endsWith('.json'))
    .map((document) => corpusFileSchema.parse(JSON.parse(document.text)));
  const inventory = createCorpusInventory({
    entries: files.filter((file) => file.kind === 'entry'),
    sources: files.filter((file) => file.kind === 'source'),
  });
  const path = join(directory, inventoryPath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${canonicalJson(inventory)}\n`);
}
