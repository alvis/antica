import { MobileStoryShell } from '../../../mobile.stories.fixtures';

import { image } from './knowledge.spec.fixtures';
import { RemoteImageReference } from './RemoteImageReference';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

const meta = {
  title: 'Mobile/Features/Knowledge/RemoteImageReference',
  component: RemoteImageReference,
  tags: ['autodocs'],
  decorators: [
    (story) => (
      <MobileStoryShell responses={{ 'GET /image/1916.3.jpg': {} }}>
        {story()}
      </MobileStoryShell>
    ),
  ],
  args: { image, caption: 'Museum chair', nearViewport: false },
  argTypes: {
    image: {
      control: false,
      description: 'Remote URL and observed rights metadata',
    },
    caption: { control: 'text', description: 'Source caption or subject' },
    nearViewport: {
      control: 'boolean',
      description: 'Starts transient image loading',
    },
  },
} satisfies Meta<typeof RemoteImageReference>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ReservedPlaceholder = {} satisfies Story;

export const FailedRemoteLoad = {
  args: { nearViewport: true },
} satisfies Story;
