import { useNavigation } from 'expo-router';

import { useCallback, useRef, useState } from 'react';

import { Alert } from 'react-native';

import { usePreventRemove } from 'expo-router/react-navigation';

import { useLocale } from '../providers/LocaleProvider';

/** whether a screen holds unsaved changes, and how it reports them */
export type LeaveConfirmation = {
  readonly dirty: boolean;
  /** reports whether the screen holds unsaved changes */
  readonly setDirty: (dirty: boolean) => void;
};

/**
 * asks before the screen is left while it holds unsaved changes, whether by the
 * hardware back button, the header back button, or a cancel action; an iOS
 * swipe-back cannot be asked about, so the screen should turn that gesture off while dirty
 * @returns whether the screen is dirty, and the setter the screen reports through
 */
export function useLeaveConfirmation(): LeaveConfirmation {
  const navigation = useNavigation();
  const { t } = useLocale();
  const [dirty, setDirtyState] = useState(false);
  // a screen that saves and leaves at once reports clean before the state commits
  const dirtyNow = useRef(false);

  usePreventRemove(dirty, ({ data }) => {
    if (!dirtyNow.current) {
      navigation.dispatch(data.action);

      return;
    }
    Alert.alert(t('discardChangesTitle'), t('discardChangesMessage'), [
      { text: t('keepEditing'), style: 'cancel' },
      {
        text: t('discardChanges'),
        style: 'destructive',
        onPress: () => navigation.dispatch(data.action),
      },
    ]);
  });

  const setDirty = useCallback((value: boolean) => {
    dirtyNow.current = value;
    setDirtyState(value);
  }, []);

  return { dirty, setDirty };
}
