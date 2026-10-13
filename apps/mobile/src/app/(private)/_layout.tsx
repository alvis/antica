import { useAuth } from '../../auth';
import { Redirect, Stack } from 'expo-router';
import { ActivityIndicator } from 'react-native';

export default function PrivateLayout() {
  const { authenticated, loading } = useAuth();
  if (loading) {
    return <ActivityIndicator accessibilityLabel="Loading session" />;
  }
  if (!authenticated) {
    return <Redirect href="/login" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
