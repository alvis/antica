import { editDraftDetailSchema, locationsSchema } from '@antica/contracts';

import type { UseQueryOptions } from '@tanstack/react-query';

import type { ApiTransport } from '@antica/client';
import type { EditDraftDetail, Location } from '@antica/contracts';

/**
 * describes the collector's saved storage locations
 * @param api authenticated API transport
 * @returns query options for the location list
 */
export function locationsQuery(api: ApiTransport): UseQueryOptions<Location[]> {
  return {
    queryKey: ['locations'],
    queryFn: async ({ signal }) =>
      api.get('/v1/locations', locationsSchema, signal),
  };
}

/**
 * describes an edit draft and its proposed record changes
 * @param api authenticated API transport
 * @param editDraftId edit draft resource, or null before one is requested
 * @param enabled whether its job has produced a result
 * @returns query options for the edit draft detail
 */
export function editDraftQuery(
  api: ApiTransport,
  editDraftId: string | null,
  enabled: boolean,
): UseQueryOptions<EditDraftDetail> {
  return {
    queryKey: ['edit-draft', editDraftId],
    enabled,
    queryFn: async ({ signal }) =>
      api.get(`/v1/edit-drafts/${editDraftId}`, editDraftDetailSchema, signal),
  };
}
