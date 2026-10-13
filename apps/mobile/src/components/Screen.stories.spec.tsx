import { expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import meta, { FixedContent, WithoutHeading } from './Screen.stories';

it('should render scrollable, fixed and self-heading story content', async () => {
  const ScreenStory = meta.component;
  const view = await render(<ScreenStory {...meta.args} />);
  expect(screen.getByRole('header')).toHaveTextContent(meta.args.title);
  expect(screen.getByText(/Saved objects/)).toBeTruthy();
  await view.rerender(<ScreenStory {...meta.args} {...FixedContent.args} />);
  expect(screen.getByRole('header')).toHaveTextContent(FixedContent.args.title);
  expect(screen.getByText(/Camera and recording controls/)).toBeTruthy();
  await view.rerender(<ScreenStory {...meta.args} {...WithoutHeading.args} />);
  expect(screen.queryByRole('header')).toBeNull();
  expect(screen.getByText(/Content can supply/)).toBeTruthy();
});
