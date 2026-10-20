import { describe, expect, it, jest } from '@jest/globals';

import {
  analysisRunDetailSchema,
  inspectionTaskSchema,
} from '@antica/contracts';

import { collectionRecord } from '../../mobile.spec.fixtures';
import {
  firstProposalId,
  run,
  runId,
  secondProposalId,
} from '../../saved-analysis.spec.fixtures';

import { media } from '../media/containers/media.spec.fixtures';

import {
  entry,
  nameChange,
  nameChangeId,
  otherDraftId,
  periodChange,
  tagsChange,
} from './messages/containers/record-messages.spec.fixtures';
import {
  angleLabel,
  carouselMedia,
  fieldBadges,
  headlineDimension,
  pendingEditChanges,
  pendingProposals,
  recordPrimary,
} from './record-hub';

import type { InspectionTask, MediaDetail } from '@antica/contracts';

import type { RecordPrimaryInput } from './record-hub';

jest.mock('../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));

/**
 * the fixture run with the collector's decisions on its proposals
 * @param states each proposal's decision
 * @returns the run as the hub reads it
 */
const decided = (
  states: Array<{
    proposalId: string;
    status: 'accepted' | 'skipped' | 'pending';
  }>,
): ReturnType<typeof analysisRunDetailSchema.parse> =>
  analysisRunDetailSchema.parse({
    ...run,
    result: {
      ...run.result,
      proposalStates: states.map((state) => ({
        ...state,
        latestAdoptionEventId: null,
      })),
    },
  });

/** a run that suggested nothing */
const quiet = analysisRunDetailSchema.parse({
  ...run,
  result: {
    ...run.result,
    output: { ...run.result.output, proposedChanges: [] },
  },
});

/**
 * a pending analysis request for the record
 * @param kind what the analysis asked for
 * @param status whether it still waits
 * @returns the inspection task as /v1/tasks lists it
 */
function actionTask(
  kind: 'capturePhoto' | 'describe',
  status: 'pending' | 'supplied' = 'pending',
): InspectionTask {
  const actionId = '00000000-0000-4000-8000-000000000701';

  return inspectionTaskSchema.parse({
    kind: 'analysisAction',
    recordId: collectionRecord.id,
    runId,
    action: {
      id: actionId,
      kind,
      instruction: '補拍底足與款識',
      reason: '請拍底足與款識，我好比對館藏實例。',
    },
    state: {
      runId,
      actionId,
      recordId: collectionRecord.id,
      revision: 1,
      status,
      latestResolutionId: null,
      updatedAt: collectionRecord.createdAt,
    },
    latestResolution: null,
  });
}

/** nothing waits on the collector */
const idle: RecordPrimaryInput = {
  analysisState: 'analysed',
  run: quiet,
  editChanges: [],
  tasks: [],
};

describe('fn:recordPrimary', () => {
  it('should leave a running analysis alone even while suggestions wait', () => {
    expect(
      recordPrimary({
        ...idle,
        analysisState: 'running',
        run,
        editChanges: [nameChange],
      }),
    ).toEqual({ kind: 'running' });
  });

  it('should put waiting suggestions first, untouched until one is decided', () => {
    expect(recordPrimary({ ...idle, run, editChanges: [nameChange] })).toEqual({
      kind: 'review',
      runId,
      count: 2,
      untouched: true,
    });
    expect(
      recordPrimary({
        ...idle,
        run: decided([{ proposalId: firstProposalId, status: 'accepted' }]),
      }),
    ).toEqual({ kind: 'review', runId, count: 1, untouched: false });
  });

  it('should ask for edit-card confirmation once every suggestion is decided', () => {
    expect(
      recordPrimary({
        ...idle,
        run: decided([
          { proposalId: firstProposalId, status: 'accepted' },
          { proposalId: secondProposalId, status: 'skipped' },
        ]),
        editChanges: [nameChange, tagsChange],
        tasks: [actionTask('capturePhoto')],
      }),
    ).toEqual({ kind: 'confirmEdits', count: 2 });
  });

  it('should offer the photo the analysis asked for before another analysis', () => {
    const task = actionTask('capturePhoto');

    expect(
      recordPrimary({
        ...idle,
        analysisState: 'failed',
        tasks: [actionTask('describe'), task],
      }),
    ).toEqual({
      kind: 'capture',
      action: task.kind === 'analysisAction' ? task.action : undefined,
    });
  });

  it('should offer analysis first once new evidence outdates the waiting suggestions', () => {
    expect(
      recordPrimary({
        ...idle,
        analysisState: 'outdated',
        run: decided([]),
        editChanges: [nameChange],
        tasks: [actionTask('capturePhoto')],
      }),
    ).toEqual({ kind: 'analyse', state: 'outdated' });
  });

  it('should ignore requests the collector already answered', () => {
    expect(
      recordPrimary({
        ...idle,
        tasks: [actionTask('capturePhoto', 'supplied')],
      }),
    ).toEqual({ kind: 'done', runId });
  });

  it.each(['unanalysed', 'failed', 'outdated'] as const)(
    'should offer analysis for an %s record with nothing waiting',
    (state) => {
      expect(
        recordPrimary({ ...idle, analysisState: state, run: undefined }),
      ).toEqual({ kind: 'analyse', state });
    },
  );

  it('should offer a retry when the latest run cannot be read', () => {
    expect(
      recordPrimary({ ...idle, analysisState: 'unknown', run: undefined }),
    ).toEqual({ kind: 'unknown' });
  });

  it('should link the finished run when nothing waits', () => {
    expect(recordPrimary(idle)).toEqual({ kind: 'done', runId });
  });
});

describe('fn:pendingProposals', () => {
  it('should keep pending and undecided proposals and drop decided ones', () => {
    expect(
      pendingProposals(
        decided([
          { proposalId: firstProposalId, status: 'skipped' },
          { proposalId: secondProposalId, status: 'pending' },
        ]),
      ).map(({ id }) => id),
    ).toEqual([secondProposalId]);
  });
});

describe('fn:pendingEditChanges', () => {
  it('should count each draft once although the message and reply share it', () => {
    const draft = { proposedChanges: [nameChange, periodChange] };

    expect(
      pendingEditChanges([
        entry('collector', 'Rename it', draft),
        entry('assistant', 'Here are the changes', draft),
      ]),
    ).toEqual([nameChange, periodChange]);
  });

  it('should leave out decided rows and drafts that wait on nobody', () => {
    expect(
      pendingEditChanges([
        entry('assistant', 'Partly done', {
          status: 'partially_applied',
          proposedChanges: [nameChange, periodChange],
          appliedProposalIds: [nameChangeId],
        }),
        {
          ...entry('assistant', 'Done', {
            status: 'applied',
            proposedChanges: [tagsChange],
          }),
          editDraftId: otherDraftId,
        },
      ]),
    ).toEqual([periodChange]);
  });

  it('should read the newest state of a draft', () => {
    expect(
      pendingEditChanges([
        entry('collector', 'Rename it', { proposedChanges: [nameChange] }),
        entry('assistant', 'Skipped', {
          proposedChanges: [nameChange],
          skippedProposalIds: [nameChangeId],
        }),
      ]),
    ).toEqual([]);
  });
});

describe('fn:fieldBadges', () => {
  it('should mark a field the analysis suggests over one an edit card changes', () => {
    const badges = fieldBadges([nameChange], [nameChange, tagsChange]);

    expect(badges.get('name')).toBe('suggestion');
    expect(badges.get('tags')).toBe('edit');
    expect(badges.has('period')).toBe(false);
  });
});

describe('fn:carouselMedia', () => {
  /**
   * a media read of the record
   * @param id asset identity
   * @param purpose what the file is for
   * @param createdAt when it was added
   * @returns the media detail
   */
  const asset = (
    id: string,
    purpose: MediaDetail['asset']['purpose'],
    createdAt: string,
  ): MediaDetail => ({
    ...media,
    asset: { ...media.asset, id, purpose, createdAt },
  });

  it('should show object photos in the order they were added and leave receipts out', () => {
    const later = asset('later', 'object', '2026-10-20T10:00:00.000Z');
    const earlier = asset('earlier', 'object', '2026-10-19T10:00:00.000Z');
    const receipt = asset('receipt', 'receipt', '2026-10-18T10:00:00.000Z');

    expect(carouselMedia([later, receipt, earlier])).toEqual([earlier, later]);
  });
});

describe('fn:angleLabel', () => {
  it.each([
    ['正面.jpg', '正面'],
    ['底足 特寫.jpeg', '底足 特寫'],
    ['bowl', 'bowl'],
  ])('should name the angle of %s as %s', (fileName, angle) => {
    expect(angleLabel(fileName)).toBe(angle);
  });

  it.each(['IMG_0042.jpg', 'DSC-1234.JPG', 'PXL_20261020.jpg', '0042.png'])(
    'should name no angle for the camera file %s',
    (fileName) => {
      expect(angleLabel(fileName)).toBeUndefined();
    },
  );
});

describe('fn:headlineDimension', () => {
  it('should lead with the diameter, then height, width and depth', () => {
    const height = { value: 8.4, unit: 'cm' as const };
    const diameter = { value: 160, unit: 'mm' as const };

    expect(headlineDimension({ height, diameter })).toEqual({
      field: 'diameter',
      measurement: diameter,
    });
    expect(headlineDimension({ height })).toEqual({
      field: 'height',
      measurement: height,
    });
  });

  it('should name nothing when only the weight is known', () => {
    expect(
      headlineDimension({ weight: { value: 1.2, unit: 'kg' } }),
    ).toBeUndefined();
  });
});
