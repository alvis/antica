import type { ImageSourcePropType } from 'react-native';

/**
 * adapts a bundled asset to an image source: Metro resolves it to an asset id and Vite to a URL
 * @param asset the imported asset
 * @returns the source an Image renders
 */
export function toImageSource(asset: string | number): ImageSourcePropType {
  return typeof asset === 'string' ? { uri: asset } : asset;
}
