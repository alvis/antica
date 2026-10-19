import { useQuery } from '@tanstack/react-query';

import { useRouter } from 'expo-router';

import { useAuth } from '../../../../providers/AuthProvider';

import { recordMessagePreviewQuery } from '../api/record-messages';
import { RecordMessagesEntry } from '../components/RecordMessagesEntry';

import type { FC } from 'react';

/** properties for the record screen's message entry */
export type RecordMessagesEntryContainerProps = { recordId: string };

/**
 * reads the newest message of a record and opens its message area
 * @param props entry properties
 * @param props.recordId record whose conversation is previewed
 * @returns the message entry with its preview
 */
export const RecordMessagesEntryContainer: FC<
  RecordMessagesEntryContainerProps
> = ({ recordId }) => {
  const router = useRouter();
  const { api } = useAuth();
  const preview = useQuery(recordMessagePreviewQuery(api, recordId));

  return (
    <RecordMessagesEntry
      preview={preview.data?.items.at(-1)?.body ?? null}
      onOpen={() => router.push(`/collection/${recordId}/messages`)}
    />
  );
};
