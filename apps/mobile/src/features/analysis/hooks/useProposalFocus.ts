import { useEffect, useRef } from 'react';

import { styles } from '@antica/ui';

import type { RefObject } from 'react';
import type { LayoutChangeEvent, ScrollView } from 'react-native';

/** scrolling to the proposal a deep link names, once its position is known */
export interface ProposalFocus {
  scrollRef: RefObject<ScrollView | null>;
  /** records where the proposals section starts inside the screen */
  onSectionLayout: (event: LayoutChangeEvent) => void;
  /** records where the focused proposal starts inside its section */
  onProposalLayout: (event: LayoutChangeEvent) => void;
}

/**
 * scrolls the analysis screen to a proposal opened from a record's change history, once
 * @param ready whether the content above the proposals has settled, so their positions are final
 * @returns the scroll handle and the layout callbacks of the section and the focused row
 */
export function useProposalFocus(ready: boolean): ProposalFocus {
  const scrollRef = useRef<ScrollView>(null);
  const layout = useRef<{
    section: number | null;
    row: number | null;
    ready: boolean;
    scrolled: boolean;
  }>({ section: null, row: null, ready, scrolled: false });
  layout.current.ready = ready;

  const scroll = (): void => {
    const { section, row, scrolled } = layout.current;
    if (scrolled || !layout.current.ready || section === null || row === null) {
      return;
    }
    layout.current.scrolled = true;
    scrollRef.current?.scrollTo({
      y: Math.max(0, section + row - styles.content.gap),
      animated: false,
    });
  };

  useEffect(() => {
    scroll();
  }, [ready]);

  return {
    scrollRef,
    onSectionLayout: (event) => {
      layout.current.section = event.nativeEvent.layout.y;
      scroll();
    },
    onProposalLayout: (event) => {
      layout.current.row = event.nativeEvent.layout.y;
      scroll();
    },
  };
}
