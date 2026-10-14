/**
 * waits for a rendered Storybook element
 * @param root story canvas root.
 * @param selector CSS selector for the expected element.
 * @returns the matching element
 */
export async function findStoryElement(
  root: HTMLElement,
  selector: string,
): Promise<HTMLElement> {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const element = root.querySelector<HTMLElement>(selector);
    if (element) {
      return element;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw new Error(`Expected Storybook element ${selector}.`);
}

/**
 * waits for observable text in a rendered Storybook canvas
 * @param root story canvas root.
 * @param expected text fragment expected in the canvas.
 */
export async function findStoryText(
  root: HTMLElement,
  expected: string,
): Promise<void> {
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    if (root.textContent.includes(expected)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
  }
  throw new Error(`Expected Storybook text ${expected}.`);
}

/**
 * waits for a labeled Storybook button
 * @param root story canvas root.
 * @param label accessible button label.
 * @returns the rendered button
 */
export async function findStoryButton(
  root: HTMLElement,
  label: string,
): Promise<HTMLElement> {
  return findStoryElement(root, `[role="button"][aria-label="${label}"]`);
}

/**
 * edits a controlled input through its native value setter
 * @param input controlled input rendered in the story canvas.
 * @param value next field value.
 */
export function setStoryInputValue(input: HTMLElement, value: string): void {
  if (!(input instanceof HTMLInputElement)) {
    throw new Error('Expected a browser input element.');
  }
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  ) as TypedPropertyDescriptor<string> & {
    set: (nextValue: string) => void;
  };
  descriptor.set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
const maximumAttempts = 100;
const retryDelayMs = 20;
