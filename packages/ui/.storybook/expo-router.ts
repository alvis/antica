import { useEffect } from 'react';

import type { EffectCallback } from 'react';

const storyRouter = {
  back: () => undefined,
  canDismiss: () => false,
  canGoBack: () => false,
  dismiss: () => undefined,
  dismissAll: () => undefined,
  dismissTo: () => undefined,
  navigate: () => undefined,
  prefetch: () => undefined,
  push: () => undefined,
  reload: () => undefined,
  replace: () => undefined,
  setParams: () => undefined,
} as const;

/**
 * returns inert navigation controls for isolated component stories
 * @returns story-safe router controls
 */
export function useRouter(): typeof storyRouter {
  return storyRouter;
}

/**
 * returns an empty route parameter set for isolated component stories
 * @returns empty route parameters
 */
export function useLocalSearchParams<
  Params extends Record<string, string | undefined>,
>(): Partial<Params> {
  return {};
}

/**
 * runs the effect once, because an isolated story screen is always the focused one
 * @param effect focus effect, returning an optional blur cleanup
 */
export function useFocusEffect(effect: EffectCallback): void {
  useEffect(effect, [effect]);
}
