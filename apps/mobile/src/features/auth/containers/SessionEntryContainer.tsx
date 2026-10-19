import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { useAuth } from '../../../providers/AuthProvider';

import type { FC } from 'react';

export const SessionEntryContainer: FC = () => {
  const { authenticated, loading } = useAuth();
  if (loading) {
    return <ActivityIndicator accessibilityLabel="Loading session" />;
  }

  return <Redirect href={authenticated ? '/collection' : '/login'} />;
};
