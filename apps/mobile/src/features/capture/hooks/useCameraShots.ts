import { useCameraPermissions } from 'expo-camera';
import { randomUUID } from 'expo-crypto';
import { useEffect, useRef, useState } from 'react';

import type { CameraView } from 'expo-camera';
import type { RefObject } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';

import type { ShotType } from '../capture-grid';

/** why the in-app camera cannot be used, if it cannot */
export type CameraFallback = 'denied' | 'unavailable' | null;

/** camera access, the current session's shots, and the shutter */
export interface CameraShots {
  /** handle the live preview attaches to */
  camera: RefObject<CameraView | null>;
  /** camera access was granted, so the preview can start */
  granted: boolean;
  fallback: CameraFallback;
  /** records that the preview failed to start */
  markUnavailable: () => void;
  shotType: ShotType;
  setShotType: (shotType: ShotType) => void;
  lastShotUri: string | null;
  shotCount: number;
  busy: boolean;
  /** the last photo could not be taken */
  failed: boolean;
  /** takes one photo and adds it to the draft */
  shoot: () => Promise<void>;
}

/**
 * describes a photo the in-app camera just took as a local draft file
 * @param uri local file the camera wrote
 * @param shotType shot type chosen when it was taken, kept only as a local hint
 * @returns the draft file, not yet uploaded
 */
function cameraShot(uri: string, shotType: ShotType): LocalMedia {
  return {
    id: randomUUID(),
    uri,
    name: `antica-${Date.now()}.jpg`,
    mimeType: 'image/jpeg',
    kind: 'photo',
    purpose: 'object',
    componentLabel: '',
    state: 'local',
    assetId: null,
    checkRequestKey: randomUUID(),
    shotType,
  };
}

/**
 * asks for camera access once, then takes photos that each join the draft as soon as they exist,
 * tagged with the chosen shot type
 * @param onShot adds a taken photo to the draft
 * @returns camera access, session shots and the shutter
 */
export function useCameraShots(
  onShot: (file: LocalMedia) => void,
): CameraShots {
  const [permission, requestPermission] = useCameraPermissions();
  const [asked, setAsked] = useState<'no' | 'asking' | 'yes'>('no');
  const [unavailable, setUnavailable] = useState(false);
  const [shotType, setShotType] = useState<ShotType>('set');
  const [lastShotUri, setLastShotUri] = useState<string | null>(null);
  const [shotCount, setShotCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const camera = useRef<CameraView>(null);
  // a second press before the first photo exists is ignored, even within one render
  const shooting = useRef(false);
  const askable = permission?.granted === false && permission.canAskAgain;

  useEffect(() => {
    if (askable && asked === 'no') {
      const answered = (): void => setAsked('yes');
      setAsked('asking');
      void requestPermission().then(answered, answered);
    }
  }, [askable, asked, requestPermission]);

  const shoot = async (): Promise<void> => {
    const view = camera.current;
    if (shooting.current || !view) {
      return;
    }
    shooting.current = true;
    setBusy(true);
    setFailed(false);
    try {
      const picture = await view.takePictureAsync({ quality: 1 });
      onShot(cameraShot(picture.uri, shotType));
      setLastShotUri(picture.uri);
      setShotCount((count) => count + 1);
    } catch {
      // the native error is not meant for collectors; the camera shows a localized message
      setFailed(true);
    } finally {
      shooting.current = false;
      setBusy(false);
    }
  };

  // while the system dialog is open the preview waits; only an answered or final refusal is denial
  const denied = permission?.granted === false && (asked === 'yes' || !askable);

  return {
    camera,
    granted: permission?.granted === true,
    fallback: unavailable ? 'unavailable' : denied ? 'denied' : null,
    markUnavailable: () => setUnavailable(true),
    shotType,
    setShotType,
    lastShotUri,
    shotCount,
    busy,
    failed,
    shoot,
  };
}
