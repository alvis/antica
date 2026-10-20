import { ResearchContainer } from '../../../features/research/containers/ResearchContainer';

import type { ReactElement } from 'react';

/**
 * research notes, opened from 我 now that research is no longer a tab
 * @returns the route's screen
 */
export default function ResearchRoute(): ReactElement {
  return <ResearchContainer />;
}
