import { MobileStoryShell } from '../../../mobile.stories.fixtures';
import {
  findStoryButton,
  findStoryElement,
  findStoryText,
} from '../../../mobile.stories.helpers';

import { expect, fn } from 'storybook/test';

import { LoginCodeStep } from './LoginCodeStep';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Auth/LoginCodeStep',
  component: LoginCodeStep,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Sign-in code step (A02–A05): masked number, WhatsApp delivery status, and a verify action that cannot submit twice',
      },
    },
  },
  render: (args) => (
    <MobileStoryShell responses={{}}>
      <LoginCodeStep {...args} />
    </MobileStoryShell>
  ),
  args: {
    maskedPhone: '+852 9••• ••28',
    delivery: 'sent',
    expired: false,
    code: '',
    onChangeCode: fn(),
    verifying: false,
    onVerify: fn(),
    resendSeconds: 42,
    onResend: fn(),
    onChangeNumber: fn(),
    error: '',
  },
  argTypes: {
    maskedPhone: { control: 'text', description: 'Already masked number' },
    delivery: {
      control: 'select',
      options: ['sending', 'sent', 'failed', 'rateLimited'],
      description: 'Where the latest code request stands',
    },
    expired: { control: 'boolean', description: 'The code expired' },
    code: { control: 'text', description: 'Current code entry' },
    verifying: { control: 'boolean', description: 'Verification is running' },
    resendSeconds: {
      control: 'number',
      description: 'Seconds before another code may be requested',
    },
    error: { control: 'text', description: 'Localized verification failure' },
    onChangeCode: { control: false },
    onVerify: { control: false },
    onResend: { control: false },
    onChangeNumber: { control: false },
  },
} satisfies Meta<typeof LoginCodeStep>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A02: the code request is still on its way */
export const Sending = {
  args: { delivery: 'sending', resendSeconds: 0 },
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, 'WhatsApp number +852 9••• ••28');
    await findStoryElement(
      canvasElement,
      '[data-testid="login-delivery-sending"]',
    );
    await findStoryText(canvasElement, 'Sending the code…');
  },
} satisfies Story;

/** A02 in the mockup's language: the code was sent through WhatsApp */
export const SentInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell locale="zh-Hant" responses={{}}>
      <LoginCodeStep {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryText(canvasElement, 'WhatsApp 號碼 +852 9••• ••28');
    await findStoryText(
      canvasElement,
      '如此號碼已獲授權，驗證碼已透過 WhatsApp 送出',
    );
    await findStoryButton(canvasElement, '重發驗證碼 (42s)');
  },
} satisfies Story;

/** A02: the request failed and can be retried at once */
export const DeliveryFailed = {
  args: { delivery: 'failed', resendSeconds: 0, onResend: fn() },
  play: async ({ args, canvasElement }) => {
    await findStoryText(
      canvasElement,
      'The code could not be sent. Check your connection and try again.',
    );
    (await findStoryButton(canvasElement, 'Retry')).click();
    await expect(args.onResend).toHaveBeenCalledTimes(1);
  },
} satisfies Story;

/** A02: the API refused another request for now */
export const RateLimited = {
  args: { delivery: 'rateLimited', resendSeconds: 60 },
  play: async ({ canvasElement }) => {
    await findStoryText(
      canvasElement,
      'Too many code requests. Wait a moment, then request a new code.',
    );
    await findStoryElement(
      canvasElement,
      '[role="button"][aria-label="Resend code (60s)"][aria-disabled="true"]',
    );
  },
} satisfies Story;

/** A04 in the mockup's language: verifying, with the button busy and locked */
export const VerifyingInTraditionalChinese = {
  render: (args) => (
    <MobileStoryShell locale="zh-Hant" responses={{}}>
      <LoginCodeStep {...args} />
    </MobileStoryShell>
  ),
  args: { code: '482619', verifying: true, onVerify: fn() },
  play: async ({ args, canvasElement }) => {
    const button = await findStoryElement(
      canvasElement,
      '[role="button"][aria-label="驗證中…"][aria-busy="true"][aria-disabled="true"]',
    );
    await findStoryText(canvasElement, '請稍候');
    button.click();
    await expect(args.onVerify).not.toHaveBeenCalled();
  },
} satisfies Story;

/** A04: a rejected code stays in the field with its explanation */
export const WrongCodeKept = {
  args: {
    code: '482619',
    error: 'That code is not correct. Check it and try again.',
    onVerify: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const input = await findStoryElement(
      canvasElement,
      'input[aria-label="Six-digit code"]',
    );
    await expect((input as HTMLInputElement).value).toBe('482619');
    await findStoryText(canvasElement, 'That code is not correct.');
    (await findStoryButton(canvasElement, 'Verify code')).click();
    await expect(args.onVerify).toHaveBeenCalledTimes(1);
  },
} satisfies Story;

/** A05: the code expired; the number is kept and a new code can be requested */
export const Expired = {
  args: { expired: true, code: '482619', resendSeconds: 0, onResend: fn() },
  play: async ({ args, canvasElement }) => {
    await findStoryText(canvasElement, 'This code has expired.');
    await findStoryText(canvasElement, '+852 9••• ••28');
    (await findStoryButton(canvasElement, 'Resend code')).click();
    await expect(args.onResend).toHaveBeenCalledTimes(1);
  },
} satisfies Story;
