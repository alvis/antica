import { expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { Text } from 'react-native';

import { Screen } from './Screen';

it.each([
  { title: 'Collection', subtitle: 'Saved items' },
  { title: 'Collection', subtitle: undefined },
  { title: undefined, subtitle: 'Saved items' },
  { title: undefined, subtitle: undefined },
])(
  'should present content with title=$title and subtitle=$subtitle',
  async ({ title, subtitle }) => {
    await render(
      <Screen title={title} subtitle={subtitle}>
        <Text>Item content</Text>
      </Screen>,
    );
    expect(screen.getByText('Item content')).toBeTruthy();
    expect(screen.queryByRole('header')?.props.children).toBe(title);
    expect(Boolean(screen.queryByText('Saved items'))).toBe(Boolean(subtitle));
  },
);
