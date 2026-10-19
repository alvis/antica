import { recordDetailSchema } from '@antica/contracts';

import type { UseQueryOptions } from '@tanstack/react-query';

import type { ApiTransport } from '@antica/client';
import type { RecordDetail } from '@antica/contracts';

/**
 * describes one collection record as the record screens show it
 * @param api authenticated API transport
 * @param recordId record to read
 * @returns query options shared by every screen that shows or invalidates the record
 */
export function recordQuery(
  api: ApiTransport,
  recordId: string,
): UseQueryOptions<RecordDetail> {
  return {
    queryKey: ['record', recordId],
    queryFn: async ({ signal }) =>
      api.get(
        `/v1/records/${encodeURIComponent(recordId)}`,
        recordDetailSchema,
        signal,
      ),
  };
}
