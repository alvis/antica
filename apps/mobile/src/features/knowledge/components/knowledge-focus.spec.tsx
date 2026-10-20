import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { AccessibilityInfo, Platform } from 'react-native';

import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { CitationPanel } from './CitationPanel';
import { citation } from './knowledge.spec.fixtures';

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

it('should restore native focus after the citation panel closes', async () => {
  const focus = jest.fn();
  const restoreFocus = { focus } as unknown as View;
  const view = await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitationPanel
        citation={citation}
        onClose={jest.fn()}
        restoreFocus={restoreFocus}
      />
    </LocaleProvider>,
  );

  await fireEvent(
    screen.getByTestId(`knowledge-citation-panel-${citation.id}`),
    'show',
  );
  expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(
    Number('42'),
  );

  await view.rerender(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitationPanel
        citation={null}
        onClose={jest.fn()}
        restoreFocus={restoreFocus}
      />
    </LocaleProvider>,
  );
  expect(focus).toHaveBeenCalledTimes(1);
  expect(AccessibilityInfo.setAccessibilityFocus).toHaveBeenCalledWith(
    Number('42'),
  );
});

it('should focus the modal heading and keep web locators usable without a section', async () => {
  const originalOS = Platform.OS;
  Platform.OS = 'web';
  try {
    const webCitation = {
      ...citation,
      locator: {
        ...citation.locator,
        kind: 'web' as const,
        url: 'https://museum.example/catalogue',
        section: undefined,
      },
      source: {
        ...citation.source,
        structuredSnapshot: { provider: 'Cleveland Museum of Art' },
      },
    } as typeof citation;
    const view = await render(
      <LocaleProvider preferences={savedPreferences('en')}>
        <CitationPanel
          citation={webCitation}
          onClose={jest.fn()}
          restoreFocus={null}
        />
      </LocaleProvider>,
    );

    await fireEvent(
      screen.getByTestId(`knowledge-citation-panel-${citation.id}`),
      'show',
    );
    expect(screen.getAllByText(/catalogue/).length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Cleveland Museum of Art/).length,
    ).toBeGreaterThan(0);
    const focus = jest.fn();
    await view.rerender(
      <LocaleProvider preferences={savedPreferences('en')}>
        <CitationPanel
          citation={null}
          onClose={jest.fn()}
          restoreFocus={{ focus } as unknown as View}
        />
      </LocaleProvider>,
    );
    expect(focus).toHaveBeenCalledTimes(1);
  } finally {
    Platform.OS = originalOS;
  }
});
