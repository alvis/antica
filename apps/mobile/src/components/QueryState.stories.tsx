import { userEvent, waitFor, within } from '@storybook/testing-library';

import { useState } from 'react';
import { Button, Text, View } from 'react-native';

import { expect, fn } from 'storybook/test';

import { LocaleProvider, useLocale } from '../locale';

import { QueryState } from './QueryState';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { FC } from 'react';

import type { QueryStateProps } from './QueryState';

/** renderer operations for the canonical query-state scenarios */
export interface QueryStateInteractions {
  /**
   * presses a rendered locale, state or retry control
   * @param label accessible control label
   * @returns completion of the interaction
   */
  pressControl(label: string): Promise<void>;
  /**
   * verifies visible text without normalizing whitespace
   * @param text expected visible text
   * @returns completion of the assertion
   */
  expectText(text: string): Promise<void>;
  /**
   * verifies text is absent from the rendered query
   * @param text text that must be absent
   * @returns completion of the assertion
   */
  expectNoText(text: string): Promise<void>;
  /**
   * verifies loading is visible and an error is absent
   * @returns completion of the assertion
   */
  expectLoading(): Promise<void>;
  /**
   * verifies content replaces loading, feedback and retry controls
   * @param text expected loaded or empty content
   * @returns completion of the assertions
   */
  expectContent(text: string): Promise<void>;
  /**
   * verifies nonempty feedback hides the supplied exception and origin
   * @param message private exception text
   * @param origin private server origin
   * @returns completion of the privacy assertions
   */
  expectPrivateAlert(message: string, origin: string): Promise<void>;
  /**
   * verifies the localized retry control is visible
   * @param label expected retry label
   * @returns completion of the assertion
   */
  expectRetry(label: string): Promise<void>;
  /**
   * verifies a stale locale's retry control is absent
   * @param label previous retry label
   * @returns completion of the assertion
   */
  expectNoRetry(label: string): Promise<void>;
  /**
   * remembers the actual nonempty feedback before a locale change
   * @returns completion of the observed feedback capture
   */
  rememberFeedback(): Promise<void>;
  /**
   * verifies current nonempty feedback differs from the remembered text
   * @returns completion of the assertion
   */
  expectChangedFeedback(): Promise<void>;
  /**
   * verifies calls to the story's actual consumer retry callback
   * @param callback original consumer callback
   * @param count expected number of calls
   * @returns completion of the assertion
   */
  expectRetryCount(
    callback: QueryStateProps['retry'],
    count: number,
  ): Promise<void>;
}

/** optional real renderer operations supplied through the loaded story context */
export interface QueryStateLoadedInteractions {
  /** supplied operations; omission selects the lazy DOM adapter */
  interactions?: QueryStateInteractions;
}

const textOptions = { normalizer: (value: string): string => value };

const loadedText = 'Three saved references are ready.';
const emptyText = 'No collected references yet.';
const privateOrigin = 'https://internal.example:8080';
const privateFailure = new Error(
  `java.net.ConnectException at ${privateOrigin}`,
);

/**
 * keeps one query mounted while public story controls change its state
 * @param props initial query state and actual consumer callback
 * @returns query content, locale controls and state controls
 */
const QueryStateDemo: FC<Readonly<QueryStateProps>> = (props) => {
  const [query, setQuery] = useState(props);
  const ready = { ...props, loading: false, error: null };
  const empty = { ...ready, children: <Text>{emptyText}</Text> };
  const failed = { ...props, loading: false, error: privateFailure };

  return (
    <View>
      <QueryState
        {...query}
        retry={() => {
          props.retry();
          setQuery(ready);
        }}
      />
      <LocaleControls />
      <Button title="Show empty result" onPress={() => setQuery(empty)} />
      <Button title="Show loaded result" onPress={() => setQuery(ready)} />
      <Button title="Show private error" onPress={() => setQuery(failed)} />
    </View>
  );
};

const meta = {
  title: 'Mobile/Components/QueryState',
  component: QueryStateDemo,
  tags: ['autodocs'],
  excludeStories: ['createDomQueryStateInteractions'],
  decorators: [(story) => <LocaleProvider>{story()}</LocaleProvider>],
  args: {
    loading: false,
    error: null,
    children: <Text>{loadedText}</Text>,
  },
  argTypes: {
    loading: { control: 'boolean', description: 'Pending query feedback' },
    error: { control: false, description: 'Private query failure' },
    children: { control: false, description: 'Settled query content' },
    retry: { control: false, description: 'Retry before recovery' },
  },
  parameters: { docs: { description: { component: 'Localized feedback' } } },
} satisfies Meta<typeof QueryStateDemo>;

export default meta;
type Story = StoryObj<typeof meta>;

/** presents settled query content */
export const Loaded = {
  args: { retry: fn<QueryStateProps['retry']>() },
  render: (args) => <QueryStateDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const interactions = getInteractions(canvasElement, loaded);
    await interactions.pressControl('English');
    await interactions.expectText('Language: English');
    await interactions.expectContent(loadedText);
    await interactions.expectRetryCount(args.retry, 0);
  },
} satisfies Story;

/** presents an empty collection without loading or error feedback */
export const Empty = {
  args: {
    children: <Text>{emptyText}</Text>,
    retry: fn<QueryStateProps['retry']>(),
  },
  render: (args) => <QueryStateDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const interactions = getInteractions(canvasElement, loaded);
    await interactions.pressControl('English');
    await interactions.expectText('Language: English');
    await interactions.expectContent(emptyText);
    await interactions.expectNoText(loadedText);
    await interactions.expectRetryCount(args.retry, 0);
  },
} satisfies Story;

/** transitions the same mounted query from loading through empty to loaded */
export const Loading = {
  args: { loading: true, retry: fn<QueryStateProps['retry']>() },
  render: (args) => <QueryStateDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const interactions = getInteractions(canvasElement, loaded);
    await interactions.pressControl('English');
    await interactions.expectText('Language: English');
    await interactions.expectLoading();
    await interactions.expectNoText(loadedText);
    await interactions.pressControl('Show empty result');
    await interactions.expectContent(emptyText);
    await interactions.expectNoText(loadedText);
    await interactions.pressControl('Show loaded result');
    await interactions.expectContent(loadedText);
    await interactions.expectNoText(emptyText);
    await interactions.expectRetryCount(args.retry, 0);
  },
} satisfies Story;

/** recovers a failed query through the actual consumer retry callback */
export const Failed = {
  args: {
    error: new Error('References could not load.'),
    retry: fn<QueryStateProps['retry']>(),
  },
  render: (args) => <QueryStateDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const interactions = getInteractions(canvasElement, loaded);
    await interactions.pressControl('English');
    await interactions.expectText('Language: English');
    await interactions.expectPrivateAlert(
      'References could not load.',
      privateOrigin,
    );
    await interactions.expectNoText(loadedText);
    await interactions.expectRetry('Retry');
    await interactions.pressControl('Retry');
    await interactions.expectRetryCount(args.retry, 1);
    await interactions.expectContent(loadedText);
  },
} satisfies Story;

/** changes fallback feedback through the real locale provider before recovery */
export const FallbackError = {
  args: { error: new Error(), retry: fn<QueryStateProps['retry']>() },
  render: (args) => <QueryStateDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const interactions = getInteractions(canvasElement, loaded);
    await interactions.pressControl('English');
    await interactions.expectText('Language: English');
    await interactions.rememberFeedback();
    await interactions.expectNoText(loadedText);
    await interactions.expectRetry('Retry');
    await interactions.pressControl('繁體中文');
    await interactions.expectText('語言：繁體中文');
    await interactions.expectChangedFeedback();
    await interactions.expectRetry('重試');
    await interactions.expectNoRetry('Retry');
    await interactions.pressControl('重試');
    await interactions.expectRetryCount(args.retry, 1);
    await interactions.expectContent(loadedText);
  },
} satisfies Story;

/** recovers the same mounted query from loading and a private error in English */
export const Recovery = {
  args: {
    loading: true,
    error: privateFailure,
    retry: fn<QueryStateProps['retry']>(),
  },
  render: (args) => <QueryStateDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const interactions = getInteractions(canvasElement, loaded);
    await interactions.pressControl('English');
    await interactions.expectText('Language: English');
    await exerciseRecovery(interactions, args.retry, 'Retry');
  },
} satisfies Story;

/** recovers the same mounted query using Traditional Chinese feedback */
export const RecoveryInTraditionalChinese = {
  args: {
    loading: true,
    error: privateFailure,
    retry: fn<QueryStateProps['retry']>(),
  },
  render: (args) => <QueryStateDemo {...args} />,
  play: async ({ args, canvasElement, loaded }) => {
    const interactions = getInteractions(canvasElement, loaded);
    await interactions.pressControl('繁體中文');
    await interactions.expectText('語言：繁體中文');
    await exerciseRecovery(interactions, args.retry, '重試');
  },
} satisfies Story;

/**
 * binds query operations to an already mounted DOM story
 * @param canvasElement actual story canvas
 * @returns DOM controls and observed query assertions
 */
export function createDomQueryStateInteractions(
  canvasElement: HTMLElement,
): QueryStateInteractions {
  const canvas = within(canvasElement);
  let previousFeedback: string | null = null;

  return {
    pressControl: async (label) => {
      await userEvent.click(await canvas.findByRole('button', { name: label }));
    },
    expectText: async (text) => {
      await expect(await canvas.findByText(text, textOptions)).toBeVisible();
    },
    expectNoText: async (text) => {
      await expect(
        canvas.queryByText(text, textOptions),
      ).not.toBeInTheDocument();
    },
    expectLoading: async () => {
      for (const indicator of canvas.getAllByRole('progressbar')) {
        await expect(indicator).toBeVisible();
      }

      await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
    },
    expectContent: async (text) => expectDomContent(canvasElement, text),
    expectPrivateAlert: async (message, origin) => {
      await expect(canvas.getByRole('alert')).toHaveTextContent(/\S/);
      await expect(canvas.getByRole('alert')).toBeVisible();
      await expect(canvasElement).not.toHaveTextContent(message);
      await expect(canvasElement).not.toHaveTextContent(origin);
      await expect(canvas.queryByRole('progressbar')).not.toBeInTheDocument();
    },
    expectRetry: async (label) => {
      await expect(
        await canvas.findByRole('button', { name: label }),
      ).toBeVisible();
    },
    expectNoRetry: async (label) => {
      await expect(
        canvas.queryByRole('button', { name: label }),
      ).not.toBeInTheDocument();
    },
    rememberFeedback: async () => {
      const alert = canvas.getByRole('alert');
      await expect(alert).toHaveTextContent(/\S/);
      previousFeedback = alert.textContent;
    },
    expectChangedFeedback: async () => {
      await waitFor(async () => {
        const alert = canvas.getByRole('alert');
        await expect(alert).toHaveTextContent(/\S/);
        await expect(alert.textContent).not.toBe(previousFeedback);
      });
    },
    expectRetryCount: async (callback, count) => {
      await expect(callback).toHaveBeenCalledTimes(count);
    },
  };
}

/**
 * exposes locale changes through the real provider's public operation
 * @returns language controls and the observed active language
 */
const LocaleControls: FC = () => {
  const { locale, setLocale } = useLocale();

  return (
    <View>
      <Button title="English" onPress={async () => setLocale('en')} />
      <Button title="繁體中文" onPress={async () => setLocale('zh-Hant')} />
      <Text>{locale === 'en' ? 'Language: English' : '語言：繁體中文'}</Text>
    </View>
  );
};

/**
 * checks recovery without replacing the mounted query or its consumer callback
 * @param interactions real renderer operations
 * @param retry original consumer retry callback
 * @param retryLabel localized retry control label
 * @returns completion of the recovery sequence
 */
async function exerciseRecovery(
  interactions: QueryStateInteractions,
  retry: QueryStateProps['retry'],
  retryLabel: string,
): Promise<void> {
  await interactions.expectLoading();
  await interactions.expectNoText(loadedText);
  await interactions.pressControl('Show private error');
  await interactions.expectPrivateAlert(privateFailure.message, privateOrigin);
  await interactions.expectNoText(loadedText);
  await interactions.expectRetry(retryLabel);
  await interactions.pressControl(retryLabel);
  await interactions.expectRetryCount(retry, 1);
  await interactions.expectContent(loadedText);
}

/**
 * selects supplied operations without evaluating the DOM fallback on native
 * @param canvasElement actual DOM canvas when no operations are supplied
 * @param loaded story-loaded renderer operations
 * @returns supplied operations or a real DOM adapter
 */
function getInteractions(
  canvasElement: HTMLElement,
  loaded: QueryStateLoadedInteractions,
): QueryStateInteractions {
  const { interactions: suppliedInteractions } = loaded;

  return suppliedInteractions ?? createDomQueryStateInteractions(canvasElement);
}

/**
 * verifies rendered query content replaces all pending and failure controls
 * @param canvasElement actual story canvas
 * @param text expected loaded or empty content
 * @returns completion of the content assertions
 */
async function expectDomContent(
  canvasElement: HTMLElement,
  text: string,
): Promise<void> {
  const canvas = within(canvasElement);

  await expect(await canvas.findByText(text, textOptions)).toBeVisible();
  await expect(canvas.queryByRole('progressbar')).not.toBeInTheDocument();
  await expect(canvas.queryByRole('alert')).not.toBeInTheDocument();
  await expect(
    canvas.queryByRole('button', { name: /^(Retry|重試)$/ }),
  ).not.toBeInTheDocument();
}
