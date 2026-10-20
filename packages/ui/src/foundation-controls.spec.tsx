import { describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  userEvent,
} from '@testing-library/react-native';

import { Text } from 'react-native';

import { ActionButton } from './ActionButton.js';
import { AskAssistantPill } from './AskAssistantPill.js';
import { Badge } from './Badge.js';
import { Card } from './Card.js';
import { SegmentControl } from './SegmentControl.js';
import { TextField } from './TextField.js';

import { theme } from './theme.js';

describe('rc:ActionButton', () => {
  it.each([{ disabled: true }, { loading: true }])(
    'should suppress activation while unavailable: %j',
    async (state) => {
      const onPress = jest.fn();
      await render(<ActionButton label="Save" onPress={onPress} {...state} />);
      const button = screen.getByRole('button', { name: 'Save' });

      await userEvent.setup().press(button);

      expect(button).toBeDisabled();
      expect(onPress).not.toHaveBeenCalled();
      if ('loading' in state) {
        expect(button).toBeBusy();
      }
    },
  );

  it('should use the sheet colours for the primary and disabled states', async () => {
    const view = await render(
      <ActionButton label="Save" onPress={jest.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toHaveStyle({
      backgroundColor: theme.color.action.primary,
    });

    await view.rerender(
      <ActionButton label="Save" onPress={jest.fn()} disabled />,
    );

    expect(screen.getByRole('button', { name: 'Save' })).toHaveStyle({
      backgroundColor: theme.color.action.disabled,
    });
  });
});

describe('rc:TextField', () => {
  it('should show focus and error state without losing the controlled value', async () => {
    const onChangeText = jest.fn();
    const onFocus = jest.fn();
    const onBlur = jest.fn();
    const view = await render(
      <TextField
        label="Object name"
        value="Chair"
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
      />,
    );
    const field = screen.getByLabelText('Object name');
    // X8: the input border is text.tertiary, not border.strong
    expect(field).toHaveStyle({ borderColor: theme.color.text.tertiary });

    await fireEvent(field, 'focus');
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(field).toHaveStyle({ borderColor: theme.color.accent.default });
    await fireEvent(field, 'blur');
    expect(onBlur).toHaveBeenCalledTimes(1);
    expect(field).toHaveStyle({ borderColor: theme.color.text.tertiary });

    await view.rerender(
      <TextField
        label="Object name"
        value="Chair"
        onChangeText={onChangeText}
        error="Name needs review"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent('Name needs review');
    expect(screen.getByLabelText('Object name')).toHaveStyle({
      borderColor: theme.color.input.errorBorder,
    });
    expect(screen.getByLabelText('Object name')).toHaveDisplayValue('Chair');
    expect(onChangeText).not.toHaveBeenCalled();
  });

  it('should mark a read-only field disabled', async () => {
    await render(
      <TextField
        label="Phone"
        value="+852"
        onChangeText={jest.fn()}
        editable={false}
      />,
    );

    expect(screen.getByLabelText('Phone')).toBeDisabled();
  });
});

describe('rc:AskAssistantPill', () => {
  it.each(['light', 'onPhoto'] as const)(
    'should expose the same accessible target in the %s variant',
    async (variant) => {
      const onPress = jest.fn();
      const view = await render(
        <AskAssistantPill
          label="Ask assistant"
          onPress={onPress}
          variant={variant}
          expanded
        />,
      );
      const pill = screen.getByRole('button', { name: 'Ask assistant' });

      expect(pill).toHaveStyle({ minHeight: 48 });
      expect(pill).toBeExpanded();
      await userEvent.setup().press(pill);
      expect(onPress).toHaveBeenCalledTimes(1);

      await view.rerender(
        <AskAssistantPill
          label="Ask assistant"
          onPress={onPress}
          variant={variant}
          disabled
        />,
      );
      await userEvent
        .setup()
        .press(screen.getByRole('button', { name: 'Ask assistant' }));
      expect(
        screen.getByRole('button', { name: 'Ask assistant' }),
      ).toBeDisabled();
      expect(onPress).toHaveBeenCalledTimes(1);
    },
  );
});

describe('rc:SegmentControl', () => {
  it('should select another enabled tab without redispatching the selected or disabled tab', async () => {
    const onChange = jest.fn();
    await render(
      <SegmentControl
        accessibilityLabel="Collection view"
        value="saved"
        onChange={onChange}
        options={[
          { value: 'saved', label: 'Saved' },
          { value: 'working', label: 'Working', badge: 6 },
          { value: 'archived', label: 'Archived', disabled: true },
        ]}
      />,
    );
    const user = userEvent.setup();

    expect(screen.getByRole('tab', { name: 'Saved' })).toBeSelected();
    expect(screen.getByText('6')).toBeVisible();
    await user.press(screen.getByRole('tab', { name: 'Saved' }));
    await user.press(screen.getByRole('tab', { name: 'Archived' }));
    expect(onChange).not.toHaveBeenCalled();
    await user.press(screen.getByRole('tab', { name: 'Working' }));

    expect(onChange.mock.calls).toEqual([['working']]);
  });
});

describe('rc:Card', () => {
  it('should keep static content readable and suppress a disabled card action', async () => {
    const onPress = jest.fn();
    const view = await render(
      <Card>
        <Text>Attached record A-001</Text>
      </Card>,
    );
    expect(screen.getByText('Attached record A-001')).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();

    await view.rerender(
      <Card onPress={onPress} accessibilityLabel="Open record" disabled>
        <Text>Attached record A-001</Text>
      </Card>,
    );
    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: 'Open record' }));

    expect(screen.getByRole('button', { name: 'Open record' })).toBeDisabled();
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('rc:Badge', () => {
  it.each([
    'accent',
    'warning',
    'danger',
    'neutral',
    'assistant',
    'onPhoto',
  ] as const)('should render the %s tone from the sheet', async (tone) => {
    await render(<Badge label="Needs photo" tone={tone} testID="badge" />);

    expect(screen.getByText('Needs photo')).toHaveStyle({
      color: theme.state.badge[tone].fg,
    });
    expect(screen.getByTestId('badge')).toHaveStyle({
      backgroundColor: theme.state.badge[tone].bg,
    });
  });
});
