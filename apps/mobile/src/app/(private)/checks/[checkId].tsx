import { useLocalSearchParams } from 'expo-router';

import { CheckContainer } from '../../../features/checks/containers/CheckContainer';

import type { CheckContainerProps } from '../../../features/checks/containers/CheckContainer';

export default function CheckRoute() {
  const { checkId } = useLocalSearchParams<CheckContainerProps>();

  return <CheckContainer checkId={checkId} />;
}
