import { TasksContainer } from '../../../features/tasks/containers/TasksContainer';

import type { ReactElement } from 'react';

/**
 * 今天: the collector's waiting work, until the v5 home replaces this list
 * @returns the route's screen
 */
export default function TodayRoute(): ReactElement {
  return <TasksContainer />;
}
