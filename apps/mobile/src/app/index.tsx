import { Redirect } from 'expo-router';
import { ActivityIndicator } from 'react-native';

import { useAuth } from '../auth';

export default function IndexRoute() {
  const { authenticated, loading } = useAuth();
  if (loading) {
    return <ActivityIndicator accessibilityLabel="Loading session" />;
  }

  return <Redirect href={authenticated ? '/collection' : '/login'} />;
}
