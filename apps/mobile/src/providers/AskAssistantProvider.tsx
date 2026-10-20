import { createContext, useContext, useMemo, useRef, useState } from 'react';

import type { FC, PropsWithChildren } from 'react';

import type { AskContext } from '../features/assistant/ask-context';

/** the one ask sheet shared by every screen */
export interface AskAssistantState {
  /** the attachment of the open sheet, or null while it is closed */
  context: AskContext | null;
  /**
   * opens the ask sheet over the current screen
   * @param context what the screen attaches
   * @param onLeave dismisses the screen's own overlay, such as the camera, before the sheet navigates
   */
  open: (context: AskContext, onLeave?: () => void) => void;
  /** closes the ask sheet and stays on the screen */
  close: () => void;
  /** closes the ask sheet and the screen's overlay, before navigating elsewhere */
  leave: () => void;
}

const AskAssistant = createContext<AskAssistantState | null>(null);

/**
 * holds which context the ask sheet shows, so every screen's pill opens the same sheet
 * @param props provider properties
 * @param props.children the app below the provider
 * @returns the children with the sheet state in context
 */
export const AskAssistantProvider: FC<PropsWithChildren> = ({ children }) => {
  const [context, setContext] = useState<AskContext | null>(null);
  const onLeave = useRef<(() => void) | undefined>(undefined);
  const value = useMemo(
    () => ({
      context,
      open: (next: AskContext, leaveOverlay?: () => void) => {
        onLeave.current = leaveOverlay;
        setContext(next);
      },
      close: () => setContext(null),
      leave: () => {
        setContext(null);
        onLeave.current?.();
      },
    }),
    [context],
  );

  return (
    <AskAssistant.Provider value={value}>{children}</AskAssistant.Provider>
  );
};

/**
 * reads the shared ask sheet
 * @returns the sheet state, or null outside the provider (isolated screen tests and stories)
 */
export function useAskAssistant(): AskAssistantState | null {
  return useContext(AskAssistant);
}
