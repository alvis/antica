import { canonicalJson, sha256 } from './canonical.js';

import type { CorpusRelease } from '@antica/contracts';

import type { CorpusContext, Located } from './context.js';

interface ManifestMember extends Located<CorpusRelease['files'][number]> {
  paths: Set<string>;
  hashes: Set<string>;
}

/**
 * Validates release selection and the self-excluding canonical digest.
 * @param context indexed corpus with exact file bytes
 * @param version requested semantic version, or the sole manifest
 */
export function validateManifest(
  context: CorpusContext,
  version?: string,
): void {
  const selected = context.releases.filter(
    (release) => version === undefined || release.value.version === version,
  );
  context.check(
    selected.length === 1,
    { file: 'releases', path: '$' },
    {
      code: 'release_count',
      message: 'Expected exactly one selected release manifest',
    },
  );
  for (const record of selected) {
    const { manifestHash, ...manifest } = record.value;
    context.check(
      manifestHash === sha256(canonicalJson(manifest)),
      { ...record, path: '$.manifestHash' },
      {
        code: 'manifest_hash',
        message: 'Manifest hash must exclude its own field',
      },
    );
    context.check(!manifest.publishedAt || Boolean(manifest.reviewer), record, {
      code: 'release_review',
      message: 'A published release requires a reviewer',
    });
    validateMembers(context, record);
  }
}

/**
 * Verifies complete release membership and unique file identities.
 * @param context indexed corpus with exact file bytes
 * @param record selected manifest and its diagnostic location
 */
function validateMembers(
  context: CorpusContext,
  record: Located<CorpusRelease>,
): void {
  const paths = new Set<string>();
  const hashes = new Set<string>();
  record.value.files.forEach((value, index) =>
    validateMember(context, {
      file: record.file,
      path: `$.files[${index}]`,
      value,
      paths,
      hashes,
    }),
  );
  for (const path of context.documents.keys()) {
    if (!path.startsWith('releases/')) {
      context.check(paths.has(path), record, {
        code: 'manifest_coverage',
        message: `Unlisted corpus file: ${path}`,
      });
    }
  }
}

/**
 * Checks safe paths and exact-byte hashes without resolving external paths.
 * @param context indexed corpus with exact file bytes
 * @param record manifest member and accumulated uniqueness sets
 */
function validateMember(context: CorpusContext, record: ManifestMember): void {
  const member = record.value;
  const safe =
    member.path.length > 0 &&
    !member.path.startsWith('/') &&
    !/^[a-z]:/i.test(member.path) &&
    !/[\\\0]/.test(member.path) &&
    !member.path
      .split('/')
      .some((part) => part === '..' || part === '.' || part === '');
  context.check(safe, record, {
    code: 'manifest_path',
    message:
      'Manifest path must be a normalized relative path without traversal',
  });
  const duplicatePath = record.paths.has(member.path);
  context.check(!duplicatePath, record, {
    code: 'manifest_duplicate_path',
    message: 'Manifest paths must be unique',
  });
  if (duplicatePath) {
    return;
  }
  context.check(!record.hashes.has(member.sha256), record, {
    code: 'manifest_duplicate_hash',
    message: 'Manifest file hashes must be unique',
  });
  record.paths.add(member.path);
  record.hashes.add(member.sha256);
  if (!safe) {
    return;
  }
  const text = context.documents.get(member.path);
  context.check(text !== undefined, record, {
    code: 'manifest_missing',
    message: `Missing manifest member: ${member.path}`,
  });
  if (text !== undefined) {
    context.check(sha256(text) === member.sha256, record, {
      code: 'file_hash',
      message: `Exact file hash mismatch: ${member.path}`,
    });
  }
  context.check(!member.path.startsWith('releases/'), record, {
    code: 'manifest_self',
    message: 'Release manifests cannot be manifest members',
  });
}
