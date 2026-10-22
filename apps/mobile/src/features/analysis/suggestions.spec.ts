import { describe, expect, it, jest } from '@jest/globals';

import { analysisRunDetailSchema, mediaDetailSchema } from '@antica/contracts';

import { collectionRecord } from '../../mobile.spec.fixtures';
import {
  evidenceId,
  firstProposalId,
  run,
  secondProposalId,
} from '../../saved-analysis.spec.fixtures';

import { supported } from './containers/analysis-reference.spec.fixtures';
import { runSuggestions, stillApplies } from './suggestions';

// the shared record fixture reaches the auth provider, whose client is not needed here
jest.mock('../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));

const secondAnchorId = '10000000-0000-4000-8000-000000000079';
const firstCitationId = '30000000-0000-4000-8000-000000000091';
const secondCitationId = '30000000-0000-4000-8000-000000000092';
const findingIds = [
  '00000000-0000-4000-8000-000000000097',
  '00000000-0000-4000-8000-000000000098',
] as const;

/** one photo whose two anchors are both cited */
const photo = mediaDetailSchema.parse({
  ...supported,
  anchors: [
    ...supported.anchors,
    { ...supported.anchors[0], id: secondAnchorId },
  ],
});

/**
 * builds a run whose first proposal rests on two findings sharing a photo and a source
 * @param proposalStates saved decisions on the proposals
 * @returns a parsed run detail
 */
function citedRun(
  proposalStates: Array<{ proposalId: string; status: string }> = [],
): ReturnType<typeof analysisRunDetailSchema.parse> {
  const output = run.result.output!;

  return analysisRunDetailSchema.parse({
    ...run,
    result: {
      ...run.result,
      proposalStates: proposalStates.map((state) => ({
        ...state,
        latestAdoptionEventId: null,
      })),
      output: {
        ...output,
        findings: findingIds.map((id, index) => ({
          id,
          kind: 'visualObservation',
          text: `Reason ${index + 1}`,
          evidenceIds: [index === 0 ? evidenceId : secondAnchorId],
          observationIds: [],
          citationIds:
            index === 0
              ? [firstCitationId, secondCitationId]
              : [secondCitationId],
          relation: 'supports',
          certainty: 'observed',
        })),
        proposedChanges: output.proposedChanges.map((change, index) =>
          index === 0 ? { ...change, findingIds: [...findingIds] } : change,
        ),
      },
    },
  });
}

describe('runSuggestions', () => {
  it('should offer every waiting proposal as open while its field is unchanged', () => {
    const result = runSuggestions(citedRun(), collectionRecord, []);

    expect(result.map((item) => [item.change.id, item.state])).toEqual([
      [firstProposalId, 'open'],
      [secondProposalId, 'open'],
    ]);
  });

  it('should mark a waiting proposal stale once its field changed since', () => {
    const edited = { ...collectionRecord, name: 'Collector name' };

    const result = runSuggestions(citedRun(), edited, []);

    expect(result.map((item) => item.state)).toEqual(['stale', 'open']);
  });

  it('should not count a proposal stale before the record is read', () => {
    const result = runSuggestions(citedRun(), undefined, []);

    expect(result.map((item) => item.state)).toEqual(['open', 'open']);
  });

  it('should keep a saved decision over staleness', () => {
    const edited = { ...collectionRecord, name: 'Blue vase', description: 'x' };

    const result = runSuggestions(
      citedRun([
        { proposalId: firstProposalId, status: 'accepted' },
        { proposalId: secondProposalId, status: 'skipped' },
      ]),
      edited,
      [],
    );

    expect(result.map((item) => item.state)).toEqual(['accepted', 'skipped']);
  });

  it('should list a photo once, opened at the first anchor cited', () => {
    const [first, second] = runSuggestions(citedRun(), collectionRecord, [
      photo,
    ]);

    expect(first.photos).toEqual([
      expect.objectContaining({
        assetId: photo.asset.id,
        anchorId: evidenceId,
      }),
    ]);
    expect(second.photos).toEqual([]);
  });

  it('should list each cited source once in finding order', () => {
    const [first] = runSuggestions(citedRun(), collectionRecord, []);

    expect(first.citationIds).toEqual([firstCitationId, secondCitationId]);
    expect(first.reasons).toEqual(['Reason 1', 'Reason 2']);
  });

  it('should offer nothing for a run without output', () => {
    const empty = analysisRunDetailSchema.parse({
      ...run,
      status: 'queued',
      result: { ...run.result, output: null },
    });

    expect(runSuggestions(empty, collectionRecord, [])).toEqual([]);
  });
});

describe('stillApplies', () => {
  it('should follow the adoption contract when comparing list order', () => {
    const change = {
      ...run.result.output!.proposedChanges[0],
      field: 'materialIds' as const,
      before: ['b', 'a'],
      proposed: ['c'],
    };

    expect(
      stillApplies(change, { ...collectionRecord, materialIds: ['b', 'a'] }),
    ).toBe(true);
    expect(
      stillApplies(change, { ...collectionRecord, materialIds: ['a', 'b'] }),
    ).toBe(false);
    expect(
      stillApplies(change, { ...collectionRecord, materialIds: ['a'] }),
    ).toBe(false);
  });
});
