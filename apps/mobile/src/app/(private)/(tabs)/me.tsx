import { SettingsContainer } from '../../../features/settings/containers/SettingsContainer';

import type { ReactElement } from 'react';

/**
 * 我: language, research notes and the session
 * @returns the route's screen
 */
export default function MeRoute(): ReactElement {
  return <SettingsContainer />;
}
