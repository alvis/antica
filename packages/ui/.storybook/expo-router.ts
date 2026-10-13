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
 * Returns inert navigation controls for isolated component stories.
 * @returns Story-safe router controls.
 */
export function useRouter(): typeof storyRouter {
  return storyRouter;
}

/**
 * Returns an empty route parameter set for isolated component stories.
 * @returns Empty route parameters.
 */
export function useLocalSearchParams<
  Params extends Record<string, string | undefined>,
>(): Partial<Params> {
  return {};
}
