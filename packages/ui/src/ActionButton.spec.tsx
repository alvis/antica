import { describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ActionButton } from './ActionButton.js';

describe('cp:ActionButton', () => {
  it('should expose a stable automation identifier on the pressable action', async () => {
    const onPress = jest.fn();
    await render(
      <ActionButton
        label="Open record"
        onPress={onPress}
        testID="open-record"
      />,
    );

    await fireEvent.press(screen.getByTestId('open-record'));

    expect(screen.getByTestId('open-record')).toHaveAccessibleName(
      'Open record',
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});
