import { useEffect, useState } from 'react';

import {
  cleanJournals,
  subscribeJournals,
  unfinishedUploads,
} from '../../../adapters/upload-journal';

import { useAuth } from '../../../providers/AuthProvider';

import type { UnfinishedUploads } from '../../../adapters/upload-journal';

/**
 * lists the signed-in collector's records whose files have not finished uploading and are not
 * open in a draft, refreshed whenever a draft opens or closes or files are discarded; opening it
 * first deletes the collector's file directories that hold no usable journal
 * @returns unfinished uploads by record, the most recent first
 */
export function useUnfinishedUploads(): UnfinishedUploads[] {
  const { userId } = useAuth();
  // signed out, nobody's uploads are offered; another collector's never are
  const owner = userId ?? '';
  const [groups, setGroups] = useState(() => unfinishedUploads(owner));

  useEffect(() => {
    cleanJournals(owner);
    // a change between the first render and subscribing is picked up here
    setGroups(unfinishedUploads(owner));

    return subscribeJournals(() => setGroups(unfinishedUploads(owner)));
  }, [owner]);

  return groups;
}
