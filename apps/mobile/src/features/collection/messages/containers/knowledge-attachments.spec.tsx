import { expect, it } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';

import { relatedAttachment } from '../../../knowledge/containers/related-knowledge.spec.fixtures';

import { useKnowledgeAttachments } from '../hooks/useKnowledgeAttachments';

it('should ignore duplicate claims and retain different claims from the same saved entry', async () => {
  const { result } = await renderHook(() => useKnowledgeAttachments(false));
  await act(() => {
    result.current.attach(relatedAttachment, 'Saved evidence');
    result.current.attach({ ...relatedAttachment }, 'Same evidence again');
    result.current.attach(
      { ...relatedAttachment, claimKey: 'another' },
      'Another claim',
    );
  });

  expect(result.current.references).toEqual([
    relatedAttachment,
    { ...relatedAttachment, claimKey: 'another' },
  ]);
  await act(() => result.current.remove(relatedAttachment));
  expect(result.current.references).toEqual([
    { ...relatedAttachment, claimKey: 'another' },
  ]);
  await act(() => result.current.clear());
  expect(result.current.references).toBeUndefined();
});

it.each([
  { limit: 6, distinctEntries: false },
  { limit: 3, distinctEntries: true },
])(
  'should reject a selection beyond the $limit grounding cap',
  async ({ limit, distinctEntries }) => {
    const { result } = await renderHook(() => useKnowledgeAttachments(false));
    await act(() => {
      for (let index = 0; index <= limit; index += 1) {
        result.current.attach(
          {
            ...relatedAttachment,
            claimKey: `claim-${index}`,
            entryId: distinctEntries
              ? `00000000-0000-4000-8000-00000000020${index}`
              : relatedAttachment.entryId,
          },
          `Claim ${index}`,
        );
      }
    });

    expect(result.current.references).toHaveLength(limit);
  },
);

it('should retain selected evidence while sending and accept changes after sending finishes', async () => {
  const { result, rerender } = await renderHook(
    ({ busy }: { busy: boolean }) => useKnowledgeAttachments(busy),
    { initialProps: { busy: false } },
  );
  await act(() => result.current.attach(relatedAttachment, 'Saved evidence'));
  await rerender({ busy: true });
  await act(() => {
    result.current.attach(
      { ...relatedAttachment, claimKey: 'another' },
      'Another claim',
    );
    result.current.remove(relatedAttachment);
  });

  expect(result.current.references).toEqual([relatedAttachment]);
  await rerender({ busy: false });
  await act(() => result.current.remove(relatedAttachment));
  expect(result.current.references).toBeUndefined();
});

it('should allow another claim from an already selected entry at the three-entry boundary', async () => {
  const { result } = await renderHook(() => useKnowledgeAttachments(false));
  const references = [
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000202',
    relatedAttachment.entryId,
  ].map((entryId) => ({ ...relatedAttachment, entryId }));
  await act(() => {
    for (const reference of references) {
      result.current.attach(reference, 'Evidence');
    }
    result.current.attach(
      { ...relatedAttachment, claimKey: 'another' },
      'Additional claim',
    );
  });

  expect(result.current.references).toEqual([
    ...references,
    { ...relatedAttachment, claimKey: 'another' },
  ]);
});
