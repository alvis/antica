import { TodayContainer } from '../../../features/today/containers/TodayContainer';

import type { ReactElement } from 'react';

/**
 * 今天: what waits for the collector, today's knowledge and the recent shelf
 * @returns the route's screen
 */
export default function TodayRoute(): ReactElement {
  return <TodayContainer />;
}
