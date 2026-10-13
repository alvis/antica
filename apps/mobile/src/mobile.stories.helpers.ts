/**
 * Waits for a rendered Storybook element.
 * @param root Story canvas root.
 * @param selector CSS selector for the expected element.
 * @returns The matching element.
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
 * Waits for observable text in a rendered Storybook canvas.
 * @param root Story canvas root.
 * @param expected Text fragment expected in the canvas.
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
 * Waits for a labelled Storybook button.
 * @param root Story canvas root.
 * @param label Accessible button label.
 * @returns The rendered button.
 */
export async function findStoryButton(
  root: HTMLElement,
  label: string,
): Promise<HTMLElement> {
  return findStoryElement(root, `[role="button"][aria-label="${label}"]`);
}

/**
 * Edits a controlled input through its native value setter.
 * @param input Controlled input rendered in the story canvas.
 * @param value Next field value.
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
