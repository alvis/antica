import { LanguageSettingsContainer } from '../../features/settings/containers/LanguageSettingsContainer';

import type { ReactElement } from 'react';

// outside the private group, so the login screen's language shortcut can open it before sign-in
export default function LanguageSettingsRoute(): ReactElement {
  return <LanguageSettingsContainer />;
}
