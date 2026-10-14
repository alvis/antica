import { decodeOwnerWire, encodeOwnerWire } from './cli-coverage/wire.mjs';
import {
  invocationSchema,
  readOwnerSnapshot,
} from './cli-coverage-global-setup.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { register } from 'node:module';

const input = process.env.ANTICA_CLI_INVOCATION;
if (!input) {
  throw new Error('CLI invocation transport is missing');
}
const invocation = invocationSchema.parse(
  JSON.parse(readFileSync(input, 'utf8')),
);
const owner = readOwnerSnapshot(decodeOwnerWire(invocation.owner));
const sourceHash = createHash('sha256')
  .update(readFileSync(new URL(invocation.sourceUrl)))
  .digest('hex');
if (sourceHash !== invocation.sourceHash) {
  throw new Error('Original CLI source changed');
}
const enabled =
  owner.project.mode.enabled && owner.project.mode.provider === 'istanbul';
if (enabled) {
  register(new URL('./cli-coverage-loader.mts', import.meta.url), {
    data: invocation,
  });
}
process.once('exit', (status) => {
  writeFileSync(
    `${invocation.output}.receipt.json`,
    JSON.stringify({
      pid: process.pid,
      preloadUrl: import.meta.url,
      token: invocation.token,
      owner: encodeOwnerWire(owner),
      sourceHash,
      sourceUrl: invocation.sourceUrl,
      status,
      cwd: process.cwd(),
      argv: process.argv,
      runtime: process.versions,
      coverage: enabled ? Reflect.get(globalThis, '__coverage__') : undefined,
    }),
  );
});
