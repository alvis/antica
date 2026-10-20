import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AccessibilityInfo } from 'react-native';

import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { CitationPanel } from '../components/CitationPanel';
import { citation } from '../components/knowledge.spec.fixtures';

import type { View } from 'react-native';

jest.mock('react-native', () => {
  const actual =
    jest.requireActual<typeof import('react-native')>('react-native');
  const replacement = Object.create(actual);
  Object.defineProperties(replacement, {
    findNodeHandle: { value: jest.fn(() => Number('42')) },
    AccessibilityInfo: {
      value: {
        ...actual.AccessibilityInfo,
        setAccessibilityFocus: jest.fn(),
      },
    },
  });

  return replacement;
});

it('should restore focus only after an opened citation closes, never when a closed panel receives its trigger ref', async () => {
  const focus = jest.fn();
  const trigger = { focus } as unknown as View;
  const close = jest.fn();
  const view = await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitationPanel citation={null} onClose={close} restoreFocus={null} />
    </LocaleProvider>,
  );

  await view.rerender(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitationPanel citation={null} onClose={close} restoreFocus={trigger} />
    </LocaleProvider>,
  );
  expect(focus).not.toHaveBeenCalled();
  expect(AccessibilityInfo.setAccessibilityFocus).not.toHaveBeenCalled();
  await view.rerender(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitationPanel
        citation={citation}
        onClose={close}
        restoreFocus={trigger}
      />
    </LocaleProvider>,
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  expect(close).toHaveBeenCalledTimes(1);
  await view.rerender(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitationPanel citation={null} onClose={close} restoreFocus={trigger} />
    </LocaleProvider>,
  );
  expect(focus).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(
    Number('42'),
  );
});
