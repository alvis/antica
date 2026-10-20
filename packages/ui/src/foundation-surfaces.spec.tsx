import { describe, expect, it, jest } from '@jest/globals';
import {
  fireEvent,
  render,
  screen,
  userEvent,
} from '@testing-library/react-native';

import { Text } from 'react-native';

import { BottomSheet } from './BottomSheet.js';
import { ChecklistChip } from './ChecklistChip.js';
import { CitationFootnote } from './CitationFootnote.js';
import { ThumbnailStrip } from './ThumbnailStrip.js';

describe('rc:ChecklistChip', () => {
  it('should announce completed and current checks while preserving the selected action', async () => {
    const onPress = jest.fn();
    const view = await render(
      <ChecklistChip
        label="Base photo"
        status="done"
        statusLabel="Taken"
        onPress={onPress}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Base photo' }),
    ).toHaveAccessibilityValue({ text: 'Taken' });
    await userEvent
      .setup()
      .press(screen.getByRole('button', { name: 'Base photo' }));
    expect(onPress).toHaveBeenCalledTimes(1);

    await view.rerender(
      <ChecklistChip
        label="Base photo"
        status="current"
        onPress={onPress}
        disabled
      />,
    );
    const chip = screen.getByRole('button', { name: 'Base photo' });
    expect(chip).toBeSelected();
    expect(chip).toBeDisabled();
    await userEvent.setup().press(chip);
    expect(onPress).toHaveBeenCalledTimes(1);

    await view.rerender(
      <ChecklistChip label="Base photo" status="todo" onPress={onPress} />,
    );
    expect(
      screen.getByRole('button', { name: 'Base photo' }),
    ).not.toBeSelected();
  });
});

describe('rc:ThumbnailStrip', () => {
  it('should identify and select an image and remove controls for an empty strip', async () => {
    const onSelect = jest.fn();
    const onFindSimilar = jest.fn();
    const view = await render(
      <ThumbnailStrip
        selectedId="front"
        onSelect={onSelect}
        action={{ label: 'Find similar', onPress: onFindSimilar }}
        items={[
          {
            id: 'front',
            uri: 'https://example.test/front.jpg',
            label: 'Front view',
          },
          {
            id: 'base',
            uri: 'https://example.test/base.jpg',
            label: 'Base view',
          },
        ]}
      />,
    );
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: 'Front view' })).toBeSelected();

    await user.press(screen.getByRole('button', { name: 'Base view' }));
    await user.press(screen.getByRole('button', { name: 'Find similar' }));

    expect(onSelect.mock.calls).toEqual([['base']]);
    expect(onFindSimilar).toHaveBeenCalledTimes(1);
    await view.rerender(<ThumbnailStrip items={[]} onSelect={onSelect} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('should count photos past its limit and end with a labelled, iconed action', async () => {
    const items = ['front', 'side', 'base', 'mark', 'rim', 'foot'].map(
      (id) => ({
        id,
        uri: `https://example.test/${id}.jpg`,
        label: `${id} view`,
        testID: `thumb-${id}`,
      }),
    );
    await render(
      <ThumbnailStrip
        items={items}
        selectedId="side"
        limit={4}
        onSelect={jest.fn()}
        action={{
          label: 'Find similar',
          icon: 'imageSearch',
          testID: 'find-similar',
          onPress: jest.fn(),
        }}
      />,
    );

    expect(screen.getAllByRole('button', { name: / view$/ })).toHaveLength(4);
    expect(screen.getByTestId('thumb-side')).toBeSelected();
    expect(screen.queryByTestId('thumb-rim')).toBeNull();
    expect(screen.getByText('+2')).toBeTruthy();
    // the icon is decorative; the action is announced by its label alone
    expect(screen.getByTestId('find-similar')).toHaveAccessibleName(
      'Find similar',
    );
    expect(screen.getByTestId('find-similar')).toHaveTextContent(
      'Find similar',
    );
  });

  it('should keep the paper mat for a photo that has no read yet', async () => {
    await render(
      <ThumbnailStrip
        items={[{ id: 'front', label: 'Front view', testID: 'thumb-front' }]}
        onSelect={jest.fn()}
      />,
    );

    expect(screen.getByTestId('thumb-front')).toHaveTextContent('');
    expect(
      screen
        .getByTestId('thumb-front')
        .children.filter((child) => typeof child !== 'string'),
    ).toHaveLength(0);
  });
});

describe('rc:CitationFootnote', () => {
  it('should expose the source as an actionable accessible citation', async () => {
    const onPress = jest.fn();
    await render(
      <CitationFootnote number={2} label="Museum catalog" onPress={onPress} />,
    );
    const citation = screen.getByRole('link', { name: /Museum catalog/ });

    expect(citation).toHaveStyle({ minHeight: 48 });
    await fireEvent.press(citation);

    expect(onPress).toHaveBeenCalledTimes(1);
  });
  it('should flow inside a line of text and still reach 48 dp through hit slop', async () => {
    const onPress = jest.fn();
    await render(
      <Text>
        A quoted claim
        <CitationFootnote
          number={4}
          label="Museum catalog"
          onPress={onPress}
          inline
        />
      </Text>,
    );
    const citation = screen.getByRole('link', { name: '4 Museum catalog' });

    // the 20 dp chip keeps the line height; 14 dp of slop on each side makes 48
    expect(citation).not.toHaveStyle({ minHeight: 48 });
    expect(citation).toHaveProp('hitSlop', 14);
    await fireEvent.press(citation);

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('rc:BottomSheet', () => {
  it('should hide closed content and dismiss with its close control and native back request', async () => {
    const onClose = jest.fn();
    const view = await render(
      <BottomSheet
        visible={false}
        title="Ask"
        closeLabel="Close assistant"
        onClose={onClose}>
        <Text>Attached record</Text>
      </BottomSheet>,
    );
    expect(screen.queryByText('Attached record')).toBeNull();

    await view.rerender(
      <BottomSheet
        visible
        testID="ask-sheet"
        title="Ask"
        closeLabel="Close assistant"
        onClose={onClose}>
        <Text>Attached record</Text>
      </BottomSheet>,
    );
    expect(screen.getByText('Attached record')).toBeVisible();
    await fireEvent.press(screen.getByText('Attached record'));
    expect(onClose).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByRole('button', { name: 'Close assistant' }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    await fireEvent(screen.getByTestId('ask-sheet'), 'requestClose');
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
