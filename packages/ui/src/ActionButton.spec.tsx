import { expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActionButton } from './index.js';

it.each([false, true])(
  'should expose and invoke an enabled action with secondary=%s',
  async (secondary) => {
    const press = jest.fn();
    await render(
      <ActionButton label="Save item" onPress={press} secondary={secondary} />,
    );

    const button = screen.getByRole('button', { name: 'Save item' });
    expect(button).toBeEnabled();
    await fireEvent.press(button);
    expect(press).toHaveBeenCalledTimes(1);
  },
);

it('should expose disabled state and prevent a disabled action', async () => {
  const press = jest.fn();
  await render(<ActionButton label="Save item" onPress={press} disabled />);

  const button = screen.getByRole('button', { name: 'Save item' });
  expect(button).toBeDisabled();
  await fireEvent.press(button);
  expect(press).not.toHaveBeenCalled();
});
