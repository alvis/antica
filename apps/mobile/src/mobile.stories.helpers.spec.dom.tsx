import { describe, expect, it } from 'vitest';

import {
  findStoryButton,
  findStoryElement,
  findStoryText,
  setStoryInputValue,
} from './mobile.stories.helpers';

const asynchronousUpdateDelay = 25;

describe('Story canvas observation', () => {
  it('should wait for a button inserted by a later DOM update', async () => {
    const canvas = document.createElement('main');
    const button = document.createElement('button');
    button.setAttribute('role', 'button');
    button.setAttribute('aria-label', 'Save');
    setTimeout(() => canvas.append(button), asynchronousUpdateDelay);

    const result = await findStoryButton(canvas, 'Save');

    expect(result).toBe(button);
  });

  it('should wait until asynchronous content becomes visible', async () => {
    const canvas = document.createElement('main');
    setTimeout(() => {
      canvas.textContent = 'Record saved';
    }, asynchronousUpdateDelay);

    await findStoryText(canvas, 'Record saved');

    expect(canvas.textContent).toBe('Record saved');
  });

  it('should reject when the expected button never appears', async () => {
    const canvas = document.createElement('main');

    await expect(findStoryElement(canvas, '[role="button"]')).rejects.toThrow(
      'Expected Storybook element [role="button"].',
    );
  });

  it('should reject when a network trace never appears', async () => {
    const canvas = document.createElement('main');
    canvas.textContent = 'Network activity: waiting';

    await expect(findStoryText(canvas, 'PATCH /v1/records')).rejects.toThrow(
      'Expected Storybook text PATCH /v1/records.',
    );
  });
});

describe('fn:setStoryInputValue', () => {
  it('should set the native value and bubble an input event to a form consumer', () => {
    const form = document.createElement('form');
    const input = document.createElement('input');
    const output = document.createElement('output');
    form.append(input, output);
    form.addEventListener('input', () => {
      output.value = input.value;
    });

    setStoryInputValue(input, 'Edited bowl');

    expect(input.value).toBe('Edited bowl');
    expect(output.value).toBe('Edited bowl');
  });

  it('should reject a rendered element that cannot receive text input', () => {
    const element = document.createElement('div');

    expect(() => setStoryInputValue(element, 'Edited bowl')).toThrow(
      'Expected a browser input element.',
    );
  });
});
