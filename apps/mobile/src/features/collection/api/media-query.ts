import { mediaDetailSchema } from '@antica/contracts';

import type { UseQueryOptions } from '@tanstack/react-query';

import type { ApiTransport } from '@antica/client';
import type { MediaDetail } from '@antica/contracts';

/**
 * describes the read for one media asset, with its signed renditions
 * @param api authenticated API transport
 * @param mediaId media asset identifier
 * @returns query options shared by the record hub and 今天
 */
export function mediaQuery(
  api: ApiTransport,
  mediaId: string,
): UseQueryOptions<MediaDetail> {
  return {
    queryKey: ['media', mediaId],
    queryFn: async ({ signal }) =>
      api.get(`/v1/media/${mediaId}`, mediaDetailSchema, signal),
  };
}
