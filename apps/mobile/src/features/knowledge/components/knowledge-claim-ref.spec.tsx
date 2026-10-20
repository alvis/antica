import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { savedPreferences } from '../../../i18n/preferences.spec.fixtures';
import { LocaleProvider } from '../../../providers/LocaleProvider';

import { CitedClaim } from './CitedClaim';
import { citation, claim } from './knowledge.spec.fixtures';

import type { ComponentProps } from 'react';

jest.mock('react-native', () => {
  const actual =
    jest.requireActual<typeof import('react-native')>('react-native');
  const react = jest.requireActual<typeof import('react')>('react');
  const replacement = Object.create(actual);
  Object.defineProperty(replacement, 'Pressable', {
    value: (props: ComponentProps<typeof actual.Pressable>) => {
      const { ref, ...withoutRef } = props;
      void ref;

      return react.createElement(actual.Pressable, withoutRef);
    },
  });

  return replacement;
});

it('should open captured evidence even when the native pressable ref is unavailable', async () => {
  const openCitation = jest.fn();
  await render(
    <LocaleProvider preferences={savedPreferences('en')}>
      <CitedClaim
        claim={claim}
        citations={[citation]}
        original={false}
        onCitation={openCitation}
      />
    </LocaleProvider>,
  );

  await fireEvent.press(
    screen.getByTestId(`knowledge-citation-${claim.claimKey}-${citation.id}`),
  );
  expect(openCitation).toHaveBeenCalledWith(citation, null);
});
