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
