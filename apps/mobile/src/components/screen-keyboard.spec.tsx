import { describe, expect, it, jest } from '@jest/globals';
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';

import { Keyboard, Platform, Text, TextInput } from 'react-native';

import { SafeAreaProvider } from 'react-native-safe-area-context';

import { Screen } from './Screen';

import type { ReactElement } from 'react';
import type { KeyboardEvent } from 'react-native';

const windowHeight = 844;
/** top inset of the screen frame below the status bar */
const statusBarHeight = 24;
const keyboardHeight = 300;

/**
 * wraps a screen in the safe-area context the app root provides
 * @param element screen under test
 * @returns the provided screen
 */
function inSafeArea(element: ReactElement): ReactElement {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: windowHeight },
        insets: { top: 24, right: 0, bottom: 0, left: 0 },
      }}>
      {element}
    </SafeAreaProvider>
  );
}

/**
 * records the keyboard listeners a screen registers
 * @returns listeners by keyboard event name
 */
function captureKeyboardListeners(): Map<
  string,
  (event: KeyboardEvent | null) => void
> {
  const listeners = new Map<string, (event: KeyboardEvent | null) => void>();
  jest.spyOn(Keyboard, 'isVisible').mockReturnValue(false);
  jest.spyOn(Keyboard, 'addListener').mockImplementation((name, listener) => {
    listeners.set(name, listener as (event: KeyboardEvent | null) => void);

    return { remove: jest.fn() } as unknown as ReturnType<
      typeof Keyboard.addListener
    >;
  });

  return listeners;
}

/**
 * lays out the keyboard frame below the status bar and opens a keyboard over its bottom
 * @param listeners keyboard listeners registered by the screen
 * @param showEvent platform event that reports the opening keyboard
 */
async function openKeyboard(
  listeners: Map<string, (event: KeyboardEvent | null) => void>,
  showEvent: string,
): Promise<void> {
  await fireEvent(screen.getByTestId('screen-keyboard-frame'), 'layout', {
    nativeEvent: {
      layout: {
        x: 0,
        y: statusBarHeight,
        width: 390,
        height: windowHeight - statusBarHeight,
      },
    },
    persist: () => undefined,
  });
  await act(async () =>
    listeners.get(showEvent)?.({
      duration: 0,
      easing: 'keyboard',
      endCoordinates: {
        screenX: 0,
        screenY: windowHeight - keyboardHeight,
        width: 390,
        height: keyboardHeight,
      },
      startCoordinates: {
        screenX: 0,
        screenY: windowHeight,
        width: 390,
        height: 0,
      },
      isEventFromThisApp: true,
    }),
  );
}

describe('rc:Screen keyboard layout (I17)', () => {
  it.each([
    ['android', 'keyboardDidShow', 'keyboardDidHide'],
    ['ios', 'keyboardWillShow', 'keyboardWillHide'],
  ] satisfies Array<[string, string, string]>)(
    'should lift scrolling content above the soft keyboard on %s and drop it again',
    async (platform, showEvent, hideEvent) => {
      jest.replaceProperty(Platform, 'OS', platform as typeof Platform.OS);
      const listeners = captureKeyboardListeners();
      await render(
        inSafeArea(
          <Screen title="Sign in">
            <TextInput testID="field" />
          </Screen>,
        ),
      );

      await openKeyboard(listeners, showEvent);

      const frame = screen.getByTestId('screen-keyboard-frame');
      expect(frame).toHaveStyle({ paddingBottom: keyboardHeight });
      expect(within(frame).getByTestId('field')).toBeTruthy();
      await act(async () => listeners.get(hideEvent)?.(null));
      expect(screen.getByTestId('screen-keyboard-frame')).toHaveStyle({
        paddingBottom: 0,
      });
    },
  );

  it('should keep a fixed composer inside the lifted frame of a non-scrolling screen', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const listeners = captureKeyboardListeners();
    await render(
      inSafeArea(
        <Screen title="Messages" scrollable={false}>
          <Text>Thread</Text>
          <TextInput testID="composer" />
        </Screen>,
      ),
    );

    await openKeyboard(listeners, 'keyboardDidShow');

    const frame = screen.getByTestId('screen-keyboard-frame');
    expect(frame).toHaveStyle({ flex: 1, paddingBottom: keyboardHeight });
    expect(within(frame).getByTestId('composer')).toBeTruthy();
    expect(within(frame).getByText('Messages')).toBeTruthy();
  });
});
