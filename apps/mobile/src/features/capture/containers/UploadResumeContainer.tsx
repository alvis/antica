import { useRouter } from 'expo-router';
import { useState } from 'react';

import { discardRecord } from '../../../adapters/upload-journal';

import { UploadResumeBanner } from '../components/UploadResumeBanner';
import { useUnfinishedUploads } from '../hooks/useUnfinishedUploads';

import type { FC } from 'react';

/**
 * offers the most recent record with unfinished uploads after a restart; resuming opens its
 * upload, which only then sends anything, and discarding deletes the local copies after a
 * confirmation while assets already started on the server stay pending there
 * @returns the banner, or nothing when every upload finished
 */
export const UploadResumeContainer: FC = () => {
  const router = useRouter();
  const unfinished = useUnfinishedUploads().at(0);
  const [confirming, setConfirming] = useState<string | null>(null);

  if (!unfinished) {
    return null;
  }

  return (
    <UploadResumeBanner
      recordLabel={unfinished.recordLabel}
      count={unfinished.count}
      confirming={confirming === unfinished.recordId}
      onResume={() =>
        router.push(`/capture?recordId=${unfinished.recordId}&resume=1`)
      }
      onDiscard={() => setConfirming(unfinished.recordId)}
      onConfirmDiscard={() => {
        setConfirming(null);
        discardRecord(unfinished);
      }}
      onKeep={() => setConfirming(null)}
    />
  );
};
