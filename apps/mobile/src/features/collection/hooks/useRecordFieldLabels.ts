import { useQueries, useQuery } from '@tanstack/react-query';

import { useKnowledgeTitles } from '../../../hooks/useKnowledgeTitles';
import { useAuth } from '../../../providers/AuthProvider';
import { shortId } from '../../../utils/short-id';

import { locationsQuery } from '../../capture/api/capture-queries';

import { mediaQuery } from '../api/media-query';

import type { UseQueryResult } from '@tanstack/react-query';

import type { Location, MediaDetail } from '@antica/contracts';

import type { FieldLabels } from '../record-edit-display';

/** identifiers whose labels a record screen shows */
export type LabelledIds = {
  /** object-type and material knowledge entries */
  readonly knowledgeIds: readonly string[];
  /** media the record holds, including its receipts */
  readonly mediaIds: readonly string[];
};

/** label lookups plus the options the editor offers */
export type RecordFieldLabels = {
  readonly labels: FieldLabels;
  /** the collector's general locations, once loaded */
  readonly locations: readonly Location[] | undefined;
  /** the record's media, once each is loaded */
  readonly media: readonly MediaDetail[];
  /** one read per media identifier, in the order given */
  readonly mediaQueries: ReadonlyArray<UseQueryResult<MediaDetail>>;
};

/**
 * reads the labels behind a record's identifiers: knowledge titles, general
 * locations, and media file names, falling back to a short identifier while one loads
 * @param ids identifiers to label
 * @returns label lookups, the location options, and the loaded media
 */
export function useRecordFieldLabels(ids: LabelledIds): RecordFieldLabels {
  const { api } = useAuth();
  const locations = useQuery(locationsQuery(api));
  const knowledge = useKnowledgeTitles(ids.knowledgeIds);
  const media = useQueries({
    queries: ids.mediaIds.map((id) => mediaQuery(api, id)),
  });
  const loadedMedia = media.flatMap((item) => (item.data ? [item.data] : []));

  return {
    labels: {
      knowledge,
      location: (id) =>
        locations.data?.find((item) => item.id === id)?.label ?? shortId(id),
      media: (id) =>
        loadedMedia.find((item) => item.asset.id === id)?.asset
          .originalFileName ?? shortId(id),
    },
    locations: locations.data,
    media: loadedMedia,
    mediaQueries: media,
  };
}
