import type { ActionButtonProps } from './ActionButton.js';
import type { TextFieldProps } from './TextField.js';

/** observable assertions shared by the canonical component stories */
export interface StoryInteractions {
  /**
   * verifies calls to the actual consumer callback supplied to the story
   * @param callback original consumer callback
   * @param count expected number of calls
   * @returns completion of the assertion
   */
  expectCallCount(
    callback: ActionButtonProps['onPress'] | TextFieldProps['onChangeText'],
    count: number,
  ): Promise<void>;

  /**
   * verifies visible text while preserving literal whitespace
   * @param text expected rendered text
   * @returns completion of the assertion
   */
  expectVisibleText(text: string): Promise<void>;
}

/** renderer operations used by the enabled and disabled action scenarios */
export interface ActionInteractions extends StoryInteractions {
  /**
   * verifies the action permits interaction
   * @returns completion of the assertion
   */
  expectEnabled(): Promise<void>;

  /**
   * verifies the action prevents interaction
   * @returns completion of the assertion
   */
  expectDisabled(): Promise<void>;

  /**
   * presses the enabled action through the renderer's user interaction API
   * @returns completion of the interaction
   */
  press(): Promise<void>;

  /**
   * attempts to press the disabled action without invoking its callback directly
   * @returns completion of the interaction
   */
  attemptDisabledPress(): Promise<void>;
}

/** renderer operations used by controlled editable and read-only field scenarios */
export interface FieldInteractions extends StoryInteractions {
  /**
   * clears the field through the renderer's user interaction API
   * @returns completion of the interaction
   */
  clear(): Promise<void>;

  /**
   * types into the field through the renderer's user interaction API
   * @param text text to enter
   * @returns completion of the interaction
   */
  type(text: string): Promise<void>;

  /**
   * verifies the rendered controlled field value
   * @param value expected field value
   * @returns completion of the assertion
   */
  expectValue(value: string): Promise<void>;

  /**
   * verifies the field prevents editing
   * @returns completion of the assertion
   */
  expectReadOnly(): Promise<void>;

  /**
   * verifies the rendered control supports multiple lines
   * @returns completion of the assertion
   */
  expectMultiline(): Promise<void>;

  /**
   * verifies the last value delivered to the actual consumer callback
   * @param callback original consumer change callback
   * @param value expected last edited value
   * @returns completion of the assertion
   */
  expectLastChangedValue(
    callback: TextFieldProps['onChangeText'],
    value: string,
  ): Promise<void>;
}

/** optional renderer operations supplied through Storybook's loaded context */
export interface LoadedInteractions<Interactions extends StoryInteractions> {
  /** supplied operations; omission selects the story's lazy DOM adapter */
  interactions?: Interactions;
}
