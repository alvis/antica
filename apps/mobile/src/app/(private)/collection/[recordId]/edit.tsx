import { Stack, useLocalSearchParams } from 'expo-router';

import { RecordEditContainer } from '../../../../features/collection/containers/RecordEditContainer';
import { useLeaveConfirmation } from '../../../../hooks/useLeaveConfirmation';

import type { ReactElement } from 'react';

import type { RecordEditContainerProps } from '../../../../features/collection/containers/RecordEditContainer';

export default function RecordEditRoute(): ReactElement {
  const { recordId } =
    useLocalSearchParams<Pick<RecordEditContainerProps, 'recordId'>>();
  const { dirty, setDirty } = useLeaveConfirmation();

  return (
    <>
      {/* iOS swipe-back cannot be asked about, so it is off while changes are unsaved */}
      <Stack.Screen options={{ gestureEnabled: !dirty }} />
      <RecordEditContainer recordId={recordId} onDirtyChange={setDirty} />
    </>
  );
}
