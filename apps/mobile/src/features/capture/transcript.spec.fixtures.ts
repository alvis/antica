import {
  editDraftDetailSchema,
  recordFieldsSchema,
  transcriptionDetailSchema,
} from '@antica/contracts';

import { collectionRecord } from '../../mobile.spec.fixtures';

export const transcriptionId = '00000000-0000-4000-8000-000000000040';
export const jobId = '00000000-0000-4000-8000-000000000041';
export const editDraftId = '00000000-0000-4000-8000-000000000042';
export const observationId = '00000000-0000-4000-8000-000000000043';
export const audioAssetId = '00000000-0000-4000-8000-000000000044';
export const nameProposalId = '00000000-0000-4000-8000-000000000045';
const descriptionProposalId = '00000000-0000-4000-8000-000000000046';
const versions = {
  recordRevision: 1,
  analysisInputVersion: 1,
  evidenceVersion: 1,
};
export const transcript = transcriptionDetailSchema.parse({
  transcriptionId,
  jobId,
  revision: 2,
  status: 'ready',
  snapshot: {
    recordId: collectionRecord.id,
    recordRevision: 1,
    audioAssetId,
    audioSha256:
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    createdAt: collectionRecord.createdAt,
  },
  result: {
    transcriptionId,
    recordId: collectionRecord.id,
    audioAssetId,
    originalText: 'Recorded words',
    readingTextZhHant: 'Recovered words',
    detectedLanguages: ['en'],
    uncertainTerms: [],
    segments: [],
  },
  invocation: null,
  confirmedObservationId: null,
  createdAt: collectionRecord.createdAt,
  updatedAt: collectionRecord.updatedAt,
});
export const editing = editDraftDetailSchema.parse({
  editDraftId,
  jobId,
  revision: 3,
  status: 'ready',
  snapshot: {
    recordId: collectionRecord.id,
    versions,
    fields: recordFieldsSchema.strip().parse(collectionRecord),
    transcriptionVersions: [{ id: transcriptionId, revision: 2 }],
    observationIds: [observationId],
    sourceText: [],
    createdAt: collectionRecord.createdAt,
  },
  result: {
    editDraftId,
    recordId: collectionRecord.id,
    baseVersions: versions,
    sourceTranscriptionIds: [transcriptionId],
    sourceObservationIds: [observationId],
    suggestedDescriptionZhHant: 'Unselected description',
    proposedChanges: [
      {
        id: nameProposalId,
        field: 'name',
        before: null,
        proposed: 'Adopted name',
        findingIds: [],
      },
      {
        id: descriptionProposalId,
        field: 'description',
        before: '',
        proposed: 'Unselected description',
        findingIds: [],
      },
    ],
  },
  invocation: null,
  appliedProposalIds: [],
  createdAt: collectionRecord.createdAt,
  updatedAt: collectionRecord.updatedAt,
});
const appliedRecord = {
  ...collectionRecord,
  name: 'Adopted name',
  recordRevision: 2,
};

/**
 * supplies persisted transcript, edit draft, and record fixtures
 * @param path requested API resource.
 * @returns the selected persisted resource
 */
export async function readCapture(path: string): Promise<unknown> {
  if (path === '/v1/locations') {
    return [];
  }
  if (path.startsWith('/v1/jobs/')) {
    return { state: { kind: 'succeeded' } };
  }
  if (path.startsWith('/v1/transcriptions/')) {
    return transcript;
  }
  if (path.startsWith('/v1/edit-drafts/')) {
    return editing;
  }

  return collectionRecord;
}

/**
 * supplies accepted confirmation and adoption responses
 * @param path requested API command.
 * @returns the command result consumed by capture
 */
export async function submitCapture(path: string): Promise<unknown> {
  if (path.endsWith('/confirm')) {
    return { observation: { id: observationId } };
  }
  if (path === '/v1/edit-drafts') {
    return { editDraftId, jobId };
  }
  if (path.endsWith('/apply')) {
    return { record: appliedRecord };
  }

  return collectionRecord;
}
