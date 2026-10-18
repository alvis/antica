import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { BusyButton } from './BusyButton';

describe('rc:BusyButton', () => {
  it('should run its action while idle and announce no busy state', async () => {
    const onPress = jest.fn();
    await render(
      <BusyButton testID="action" label="Verify" onPress={onPress} />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Verify' }));

    expect(onPress).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('action')).toHaveProp('accessibilityState', {
      busy: false,
      disabled: false,
    });
    expect(screen.queryByTestId('action-spinner')).toBeNull();
  });

  it('should show a spinner, announce busy, and ignore presses while busy', async () => {
    const onPress = jest.fn();
    await render(
      <BusyButton testID="action" label="Verifying…" onPress={onPress} busy />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Verifying…' }));

    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('action')).toHaveProp('accessibilityState', {
      busy: true,
      disabled: true,
    });
    expect(screen.getByTestId('action-spinner')).toBeTruthy();
  });

  it('should render an outlined, disabled action without an automation identifier', async () => {
    const onPress = jest.fn();
    await render(
      <BusyButton label="Retry" onPress={onPress} disabled busy secondary />,
    );

    await fireEvent.press(screen.getByRole('button', { name: 'Retry' }));

    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeDisabled();
    expect(screen.queryByTestId('undefined-spinner')).toBeNull();
    expect(screen.queryByTestId(/-spinner$/)).toBeNull();
  });
});
