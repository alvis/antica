import { userEvent, within } from '@storybook/testing-library';

import { useState } from 'react';
import { Button, Text, View } from 'react-native';

import { expect } from 'storybook/test';

import { Screen } from './Screen';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { FC } from 'react';

import type { ScreenProps } from './Screen';

/** real renderer operations for heading and content-branch scenarios */
export interface ScreenInteractions {
  /**
   * presses a public story control to update the same mounted screen
   * @param label accessible control label
   * @returns completion of the interaction
   */
  pressControl(label: string): Promise<void>;
  /**
   * verifies visible content without normalizing whitespace
   * @param text expected text
   * @returns completion of the assertion
   */
  expectText(text: string): Promise<void>;
  /**
   * verifies stale content or subtitle text is absent
   * @param text text that must be absent
   * @returns completion of the assertion
   */
  expectNoText(text: string): Promise<void>;
  /**
   * verifies a visible accessible heading
   * @param title expected heading text
   * @returns completion of the assertion
   */
  expectHeading(title: string): Promise<void>;
  /**
   * verifies no accessible heading is rendered
   * @returns completion of the assertion
   */
  expectNoHeading(): Promise<void>;
  /**
   * verifies the real scrollable container branch without geometry claims
   * @returns completion of the rendered-structure assertion
   */
  expectScrollable(): Promise<void>;
  /**
   * verifies the fixed branch has no scrollable container
   * @returns completion of the rendered-structure assertion
   */
  expectFixed(): Promise<void>;
}

/** optional real renderer operations supplied through the loaded story context */
export interface ScreenLoadedInteractions {
  /** supplied operations; omission selects the lazy DOM adapter */
  interactions?: ScreenInteractions;
}

const collectionText = 'Saved objects and research appear here.';
const fixedText =
  'Camera and recording controls stay in the fixed content area.';
const selfHeadingText = 'Content can supply its own heading.';
const collectionSubtitle = 'Your private collection and research';

const meta = {
  title: 'Mobile/Components/Screen',
  component: Screen,
  tags: ['autodocs'],
  excludeStories: ['createDomScreenInteractions'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Screen headings and scrollable or fixed content structure',
      },
    },
  },
  args: {
    title: 'Collection',
    subtitle: collectionSubtitle,
    children: <Text>{collectionText}</Text>,
  },
  argTypes: {
    title: { control: 'text', description: 'Optional accessible heading' },
    subtitle: {
      control: 'text',
      description: 'Optional text beneath the heading',
    },
    scrollable: {
      control: 'boolean',
      description: 'Uses the scrollable content branch',
    },
    children: {
      control: false,
      description: 'Content presented by the screen',
    },
    scrollRef: {
      control: false,
      description: 'Optional handle for the scrollable container',
    },
    action: {
      control: false,
      description: 'Optional header control beside the heading',
    },
  },
  render: (args) => <ScreenDemo {...args} />,
} satisfies Meta<typeof Screen>;

export default meta;
type Story = StoryObj<typeof meta>;

/** changes one mounted screen from scrollable to fixed to self-heading content */
export const Scrollable = {
  args: { scrollable: true },
  play: async ({ canvasElement, loaded }) => {
    const { interactions: suppliedInteractions }: ScreenLoadedInteractions =
      loaded;
    const interactions =
      suppliedInteractions ?? createDomScreenInteractions(canvasElement);
    await interactions.expectHeading('Collection');
    await interactions.expectText(collectionSubtitle);
    await interactions.expectText(collectionText);
    await interactions.expectScrollable();
    await interactions.pressControl('Show fixed content');
    await interactions.expectHeading('Capture');
    await interactions.expectText(fixedText);
    await interactions.expectNoText(collectionSubtitle);
    await interactions.expectNoText(collectionText);
    await interactions.expectFixed();
    await interactions.pressControl('Show self-heading content');
    await interactions.expectNoHeading();
    await interactions.expectText(selfHeadingText);
    await interactions.expectNoText('Capture');
    await interactions.expectNoText(fixedText);
    await interactions.expectScrollable();
  },
} satisfies Story;

/** presents a title with fixed camera and recording content */
export const FixedContent = {
  args: {
    title: 'Capture',
    subtitle: undefined,
    scrollable: false,
    children: (
      <View style={{ padding: 16 }}>
        <Text>{fixedText}</Text>
      </View>
    ),
  },
  play: async ({ canvasElement, loaded }) => {
    const { interactions: suppliedInteractions }: ScreenLoadedInteractions =
      loaded;
    const interactions =
      suppliedInteractions ?? createDomScreenInteractions(canvasElement);
    await interactions.expectHeading('Capture');
    await interactions.expectText(fixedText);
    await interactions.expectNoText(collectionSubtitle);
    await interactions.expectFixed();
  },
} satisfies Story;

/** lets scrollable content provide its own heading */
export const WithoutHeading = {
  args: {
    title: undefined,
    subtitle: undefined,
    scrollable: true,
    children: <Text>{selfHeadingText}</Text>,
  },
  play: async ({ canvasElement, loaded }) => {
    const { interactions: suppliedInteractions }: ScreenLoadedInteractions =
      loaded;
    const interactions =
      suppliedInteractions ?? createDomScreenInteractions(canvasElement);
    await interactions.expectNoHeading();
    await interactions.expectNoText(collectionSubtitle);
    await interactions.expectText(selfHeadingText);
    await interactions.expectScrollable();
  },
} satisfies Story;

/** exercises the omitted scrollable default with a subtitle and no title */
export const SubtitleOnly = {
  args: { title: undefined },
  play: async ({ canvasElement, loaded }) => {
    const { interactions: suppliedInteractions }: ScreenLoadedInteractions =
      loaded;
    const interactions =
      suppliedInteractions ?? createDomScreenInteractions(canvasElement);
    await interactions.expectNoHeading();
    await interactions.expectText(collectionSubtitle);
    await interactions.expectText(collectionText);
    await interactions.expectScrollable();
  },
} satisfies Story;

/** places a header control, such as the Settings gear, beside the heading */
export const WithAction = {
  args: { action: <Text>Settings action</Text> },
  play: async ({ canvasElement, loaded }) => {
    const { interactions: suppliedInteractions }: ScreenLoadedInteractions =
      loaded;
    const interactions =
      suppliedInteractions ?? createDomScreenInteractions(canvasElement);
    await interactions.expectHeading('Collection');
    await interactions.expectText('Settings action');
    await interactions.expectText(collectionText);
  },
} satisfies Story;

/** presents fixed content without title or subtitle containers */
export const FixedWithoutHeading = {
  args: {
    title: undefined,
    subtitle: undefined,
    scrollable: false,
    children: <Text>{selfHeadingText}</Text>,
  },
  play: async ({ canvasElement, loaded }) => {
    const { interactions: suppliedInteractions }: ScreenLoadedInteractions =
      loaded;
    const interactions =
      suppliedInteractions ?? createDomScreenInteractions(canvasElement);
    await interactions.expectNoHeading();
    await interactions.expectNoText(collectionSubtitle);
    await interactions.expectText(selfHeadingText);
    await interactions.expectFixed();
  },
} satisfies Story;

/**
 * binds screen assertions to the real mounted DOM structure
 * @param canvasElement actual story canvas
 * @returns controls and branch assertions without viewport or scroll-distance claims
 */
export function createDomScreenInteractions(
  canvasElement: HTMLElement,
): ScreenInteractions {
  const canvas = within(canvasElement);

  return {
    pressControl: async (label) => {
      await userEvent.click(await canvas.findByRole('button', { name: label }));
    },
    expectText: async (text) => {
      await expect(
        await canvas.findByText(text, { normalizer: (value) => value }),
      ).toBeVisible();
    },
    expectNoText: async (text) => {
      await expect(
        canvas.queryByText(text, { normalizer: (value) => value }),
      ).not.toBeInTheDocument();
    },
    expectHeading: async (title) => {
      await expect(
        await canvas.findByRole('heading', { name: title }),
      ).toBeVisible();
    },
    expectNoHeading: async () => {
      await expect(canvas.queryByRole('heading')).not.toBeInTheDocument();
    },
    expectScrollable: async () => {
      const scrollContainers = Array.from(
        canvasElement.querySelectorAll('*'),
      ).filter((element) => getComputedStyle(element).overflowY === 'auto');
      await expect(scrollContainers).toHaveLength(1);
      await expect(scrollContainers[0]).toBeVisible();
    },
    expectFixed: async () => {
      const scrollContainers = Array.from(
        canvasElement.querySelectorAll('*'),
      ).filter((element) => getComputedStyle(element).overflowY === 'auto');
      await expect(scrollContainers).toHaveLength(0);
    },
  };
}

/**
 * changes props on one mounted screen through explicit content controls
 * @param props initial heading, content and scrollable properties
 * @returns the screen and its content-transition controls
 */
const ScreenDemo: FC<Readonly<ScreenProps>> = (props) => {
  const [current, setCurrent] = useState<ScreenProps>(props);

  return (
    <View style={{ flex: 1 }}>
      <Screen {...current} />
      <Button
        title="Show fixed content"
        onPress={() => setCurrent(FixedContent.args)}
      />
      <Button
        title="Show self-heading content"
        onPress={() => setCurrent(WithoutHeading.args)}
      />
    </View>
  );
};
