import type { QueryClient, UseQueryOptions } from '@tanstack/react-query';

/** what the record screen tells the collector after the editor closed */
export type RecordEditNotice = 'refreshed' | null;

/**
 * names the notice the editor leaves for the record screen it returns to
 * @param recordId record the notice is about
 * @returns query key of the notice
 */
function recordEditNoticeKey(recordId: string): readonly string[] {
  return ['record-edit-notice', recordId];
}

/**
 * describes the notice the record screen shows after an edit; it lives only in
 * memory and is never read from the API
 * @param recordId record the notice is about
 * @returns query options that start without a notice
 */
export function recordEditNoticeQuery(
  recordId: string,
): UseQueryOptions<
  RecordEditNotice,
  Error,
  RecordEditNotice,
  readonly string[]
> {
  return {
    queryKey: recordEditNoticeKey(recordId),
    queryFn: () => null,
    initialData: null,
    staleTime: Number.POSITIVE_INFINITY,
  };
}

/**
 * leaves or clears the notice for the record screen
 * @param client query client shared by the screens
 * @param recordId record the notice is about
 * @param notice notice to show, or null to clear it
 */
export function setRecordEditNotice(
  client: QueryClient,
  recordId: string,
  notice: RecordEditNotice,
): void {
  client.setQueryData(recordEditNoticeKey(recordId), notice);
}
