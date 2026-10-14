import { createHash } from 'node:crypto';

import { failure } from './failure.js';

import type {
  SourceAccepted,
  SourceCommand,
  SourceDetail,
} from '@antica/contracts';
import type { Source, SourceVersion } from '@antica/domain';

import type {
  ClockPort,
  IdPort,
  OperationResult,
  UnitOfWork,
} from '../../ports/index.js';

/** inputs for source registration within submission's transaction */
export interface RegistrationParams {
  readonly unit: UnitOfWork;
  readonly ownerId: string;
  readonly command: RegistrationCommand;
  readonly insertReceipt: (accepted: SourceAccepted) => Promise<void>;
  readonly clock: ClockPort;
  readonly ids: IdPort;
}

type RegistrationCommand = Extract<
  SourceCommand,
  { readonly mode: 'register' }
>;
type Registration = RegistrationCommand['registration'];
type OrderedAsset = Registration['assets'][number];
type RegistrationMedia = Awaited<ReturnType<UnitOfWork['media']['get']>>;

interface ValidatedRegistration {
  readonly ordered: readonly OrderedAsset[];
  readonly sourceHash: string;
}

interface RegisteredVersionParams {
  readonly registration: Registration;
  readonly ordered: readonly OrderedAsset[];
  readonly sourceHash: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly now: string;
}

interface QueueRegisteredVersionParams {
  readonly params: RegistrationParams;
  readonly now: string;
  readonly sourceId: string;
  readonly sourceVersionId: string;
  readonly jobId: string;
}

/**
 * validates registered assets and either reuses or creates a source version
 * @param params authenticated registration and existing submit transaction
 * @returns accepted source job or the original validation/CAS failure
 */
export async function submitRegistration(
  params: RegistrationParams,
): Promise<OperationResult<SourceAccepted>> {
  const validated = await validateRegistration(
    params.unit,
    params.command.registration,
  );
  if (!validated.success) {
    return validated;
  }
  const duplicate = await params.unit.sources.findVersionByHash(
    validated.data.sourceHash,
  );
  if (duplicate) {
    const jobId = await params.unit.sources.getIngestionJobId(duplicate.id);
    if (!jobId) {
      return failure(
        'SOURCE_UNAVAILABLE',
        'Existing source job is unavailable',
      );
    }
    const accepted = {
      sourceId: duplicate.sourceId,
      sourceVersionId: duplicate.id,
      jobId,
    };
    await params.insertReceipt(accepted);

    return { success: true, data: accepted };
  }

  return createRegistration(params, validated.data);
}

/**
 * validates asset order, ownership and media type before computing the source hash
 * @param unit existing authenticated transaction
 * @param registration requested source and ordered original assets
 * @returns ordered assets and hash, or the first validation failure
 */
async function validateRegistration(
  unit: UnitOfWork,
  registration: Registration,
): Promise<OperationResult<ValidatedRegistration>> {
  const ordered = [...registration.assets].sort(
    (left, right) => left.order - right.order,
  );
  if (
    ordered.length === 0 ||
    ordered.some((asset, index) => asset.order !== index) ||
    new Set(ordered.map((asset) => asset.assetId)).size !== ordered.length
  ) {
    return failure(
      'VALIDATION_FAILED',
      'Source pages need a unique contiguous order',
    );
  }
  if (registration.kind === 'book_pdf' && ordered.length !== 1) {
    return failure(
      'VALIDATION_FAILED',
      'A PDF source needs exactly one PDF asset',
    );
  }
  if (
    registration.metadata.authorStatus === 'unknown' &&
    registration.metadata.contributors.some(
      (contributor) => contributor.role === 'author',
    )
  ) {
    return failure(
      'VALIDATION_FAILED',
      'Unknown author cannot have a named author attribution',
    );
  }
  const media = await Promise.all(
    ordered.map(async (asset) => unit.media.get(asset.assetId)),
  );
  const mediaValidation = validateRegistrationMedia(registration, media);
  if (!mediaValidation.success) {
    return mediaValidation;
  }
  const sourceHash = createHash('sha256')
    .update(
      JSON.stringify({
        kind: registration.kind,
        assets: ordered.map((asset, index) => ({
          checksum: media[index]?.sha256,
          printedPageLabel: asset.printedPageLabel,
          presentation: asset.presentation ?? null,
        })),
      }),
    )
    .digest('hex');

  return { success: true, data: { ordered, sourceHash } };
}

/**
 * checks every original asset for intake ownership, readiness and supported media
 * @param registration requested source type and intake identity
 * @param media assets read in the registration's original order
 * @returns the first media validation failure, or success
 */
function validateRegistrationMedia(
  registration: Registration,
  media: readonly RegistrationMedia[],
): OperationResult<void> {
  for (const asset of media) {
    if (
      asset?.owner.kind !== 'source_intake' ||
      asset.owner.intakeKey !== registration.intakeKey
    ) {
      return failure(
        'FORBIDDEN',
        'Source asset does not belong to this intake',
      );
    }
    if (asset.state !== 'ready') {
      return failure('UPLOAD_INCOMPLETE', 'Source asset upload is incomplete');
    }
    if (
      registration.kind === 'book_pdf' &&
      (asset.purpose !== 'book_file' || asset.mimeType !== 'application/pdf')
    ) {
      return failure(
        'MEDIA_UNSUPPORTED',
        'PDF source requires a PDF book file',
      );
    }
    if (
      registration.kind === 'book_pages' &&
      (asset.purpose !== 'book_page' ||
        !['image/jpeg', 'image/png', 'image/webp', 'image/tiff'].includes(
          asset.mimeType,
        ))
    ) {
      return failure(
        'MEDIA_UNSUPPORTED',
        'Book pages require supported image assets',
      );
    }
  }

  return { success: true, data: undefined };
}

/**
 * persists a new version, job, outbox event and receipt in submission's transaction
 * @param params authenticated registration and allocators
 * @param validated ordered original assets and validated content hash
 * @returns accepted identifiers or a source revision conflict
 */
async function createRegistration(
  params: RegistrationParams,
  validated: ValidatedRegistration,
): Promise<OperationResult<SourceAccepted>> {
  const { unit, command, clock, ids } = params;
  const { registration } = command;
  const { ordered, sourceHash } = validated;
  const prior = await readExistingRegistration(unit, registration);
  if (!prior.success) {
    return prior;
  }
  const existing = prior.data;
  const now = clock.now();
  const sourceId = existing?.source.id ?? ids.create();
  const sourceVersionId = ids.create();
  const jobId = ids.create();
  const version = createRegisteredVersion({
    registration,
    ordered,
    sourceHash,
    sourceId,
    sourceVersionId,
    now,
  });
  if (existing) {
    const changed = await unit.sources.addVersion(
      version,
      existing.source.revision,
      ordered,
    );
    if (!changed) {
      return failure('REVISION_CONFLICT', 'Source changed during registration');
    }
  } else {
    const source: Source = {
      id: sourceId,
      revision: 1,
      createdAt: now,
      updatedAt: now,
      kind: registration.kind,
      metadata: registration.metadata,
      currentVersionId: sourceVersionId,
    };
    await unit.sources.create(source, version, ordered);
  }

  return queueRegisteredVersion({
    params,
    now,
    sourceId,
    sourceVersionId,
    jobId,
  });
}

/**
 * reads and checks an existing source before allocating registration IDs
 * @param unit existing owner-scoped submission transaction
 * @param registration requested source identity and expected revision
 * @returns the current source or the original missing/revision failure
 */
async function readExistingRegistration(
  unit: UnitOfWork,
  registration: Registration,
): Promise<OperationResult<SourceDetail | null>> {
  const existing = registration.existingSourceId
    ? await unit.sources.get(registration.existingSourceId)
    : null;
  if (registration.existingSourceId && !existing) {
    return failure('NOT_FOUND', 'Source not found');
  }
  if (
    existing &&
    (existing.source.kind !== registration.kind ||
      existing.source.revision !== registration.expectedRevision)
  ) {
    return failure('REVISION_CONFLICT', 'Source changed since it was opened');
  }

  return { success: true, data: existing };
}

/**
 * builds the registered version after its clock and IDs have been allocated
 * @param params validated assets, source identity and capture time
 * @returns the original registered version state
 */
function createRegisteredVersion(
  params: RegisteredVersionParams,
): SourceVersion {
  const { registration, ordered, sourceHash, sourceId, sourceVersionId, now } =
    params;

  return {
    id: sourceVersionId,
    sourceId,
    originalAssetIds: ordered.map((asset) => asset.assetId),
    sourceHash,
    metadataSnapshot: registration.metadata,
    capturedAt: now,
    retrievedAt: null,
    status: 'registered',
    textIndexStatus: 'registered',
    imageIndexStatus: 'registered',
    activeParseRunId: null,
  };
}

/**
 * queues ingestion and records its receipt after the source version is saved
 * @param input existing transaction, allocated IDs and timestamp
 * @returns accepted source and job identity
 */
async function queueRegisteredVersion(
  input: QueueRegisteredVersionParams,
): Promise<OperationResult<SourceAccepted>> {
  const { params, now, sourceId, sourceVersionId, jobId } = input;
  const { unit, ownerId, command, ids } = params;
  await unit.jobs.create({
    id: jobId,
    kind: 'sourceIngestion',
    resourceId: sourceVersionId,
    state: { kind: 'queued' },
    createdAt: now,
    updatedAt: now,
    result: null,
  });
  await unit.outbox.enqueue({
    id: ids.create(),
    name: 'sourceIngestion',
    event: {
      eventId: ids.create(),
      schemaVersion: '1',
      jobId,
      resourceId: sourceVersionId,
      ownerId,
      idempotencyKey: command.requestKey,
    },
    createdAt: now,
    sentAt: null,
  });
  const accepted = { sourceId, sourceVersionId, jobId };
  await params.insertReceipt(accepted);

  return { success: true, data: accepted };
}
