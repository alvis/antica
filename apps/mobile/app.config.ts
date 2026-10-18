import { withAndroidDevSupport } from './plugins/withAndroidDevSupport.mjs';

import type { ExpoConfig } from 'expo/config';

const config = {
  name: 'Antica',
  slug: 'antica',
  scheme: 'antica',
  ios: {
    bundleIdentifier: 'app.antica.collector',
  },
  android: {
    package: 'app.antica.collector',
  },
  plugins: [
    'expo-router',
    [
      'expo-image-picker',
      {
        photosPermission:
          'Allow Antica to import photos of your collection and book pages.',
        cameraPermission: 'Allow Antica to photograph your collection.',
        microphonePermission:
          'Allow Antica to record voice notes for your collection.',
      },
    ],
    [
      'expo-camera',
      {
        cameraPermission: 'Allow Antica to photograph your collection.',
        microphonePermission:
          'Allow Antica to record voice notes for your collection.',
        recordAudioAndroid: false,
        barcodeScannerEnabled: false,
      },
    ],
    [
      'expo-audio',
      {
        microphonePermission:
          'Allow Antica to record voice notes for your collection.',
        recordAudioAndroid: true,
        enableBackgroundRecording: false,
        enableBackgroundPlayback: false,
      },
    ],
    ['expo-secure-store', { faceIDPermission: false }],
    'expo-localization',
  ],
} satisfies ExpoConfig;

export default withAndroidDevSupport(config);
