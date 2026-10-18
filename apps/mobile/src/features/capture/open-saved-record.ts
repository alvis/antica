import { discardFile } from '../../adapters/upload-journal';

import type { QueryClient } from '@tanstack/react-query';

import type { useRouter } from 'expo-router';

import type { RecordDetail } from '@antica/contracts';

import type { LocalMedia } from '../../adapters/media-upload';

/** what opening a saved record refreshes and navigates with */
export interface SavedRecordContext {
  queryClient: QueryClient;
  router: ReturnType<typeof useRouter>;
  /** signed-in collector whose documents keep the journals */
  userId: string | null;
  /** check the capture answers, kept on the record's route */
  checkId: string | undefined;
}

/**
 * forgets the deselected files kept for the record, refreshes the record and opens it
 * @param context query cache, navigator, collector and check
 * @param record the record as the server saved it
 * @param files draft files as they were sent
 */
export async function openSavedRecord(
  context: SavedRecordContext,
  record: RecordDetail,
  files: LocalMedia[],
): Promise<void> {
  const { queryClient, router, userId, checkId } = context;
  // a deselected file never uploads, so its journal and copy have nothing left to do
  for (const file of files) {
    if (file.excluded && file.copyUri && userId) {
      discardFile({ userId, recordId: record.id }, file.id);
    }
  }
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['records'] }),
    queryClient.invalidateQueries({ queryKey: ['record', record.id] }),
    queryClient.invalidateQueries({ queryKey: ['observations', record.id] }),
  ]);
  const query = checkId ? `?checkId=${checkId}` : '';
  router.replace(`/collection/${record.id}${query}`);
}
