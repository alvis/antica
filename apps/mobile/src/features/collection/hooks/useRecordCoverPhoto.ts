import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '../../../providers/AuthProvider';

import { mediaQuery } from '../api/media-query';
import { recordQuery } from '../api/record-query';

import type { MediaDetail } from '@antica/contracts';

/**
 * tells whether a medium can be the record's cover
 * @param detail the medium
 * @returns whether it is a photo of the object, not of a receipt or a document
 */
function isObjectPhoto(detail: MediaDetail): boolean {
  return detail.asset.purpose === 'object' && detail.asset.kind === 'photo';
}

/**
 * the record's first object photo at display size, the rendition the record hero shows; a list
 * thumbnail blurs on a full-width card. The media are read one at a time in the record's order
 * until an object photo turns up, so a card costs one media read when the record starts with its
 * photos, instead of one per medium
 * @param recordId record whose cover is shown
 * @returns the photo's signed URL, once the record and that photo have loaded
 */
export function useRecordCoverPhoto(recordId: string): string | undefined {
  const { api } = useAuth();
  const queryClient = useQueryClient();
  const record = useQuery(recordQuery(api, recordId));
  // the first medium not yet known to be something other than an object photo; each read that
  // turns out to be a receipt re-renders this hook and moves on to the next
  const candidateId = record.data?.mediaIds.find((id) => {
    const known = queryClient.getQueryData<MediaDetail>(['media', id]);

    return known === undefined || isObjectPhoto(known);
  });
  const candidate = useQuery({
    ...mediaQuery(api, candidateId ?? ''),
    enabled: candidateId !== undefined,
  });

  return candidate.data && isObjectPhoto(candidate.data)
    ? candidate.data.reads.at(0)?.url
    : undefined;
}
