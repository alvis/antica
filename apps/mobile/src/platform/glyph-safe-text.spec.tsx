import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { Text } from 'react-native';

import { bundledFaces } from '@antica/ui/faces';

import { GlyphSafeText, withTrailingRoom } from './glyph-safe-text';

const serif = { fontFamily: 'NotoSerifTC-Bold', fontSize: 19 };
const sans = { fontFamily: 'NotoSansTC-Regular', fontSize: 15 };

describe('fn:withTrailingRoom', () => {
  it('should end text with a hair space and keep its words as the label', () => {
    expect(withTrailingRoom(['語言', ' · ', 2])).toEqual({
      children: ['語言', ' · ', 2, '\u200A'],
      label: '語言 · 2',
    });
  });

  it('should label mixed text with its own words and the words nested in it', () => {
    const room = withTrailingRoom([
      '查看',
      <Text key="name">
        汝窯<Text>洗</Text>
      </Text>,
      <Text key="icon" />,
      '紀錄',
    ]);

    expect((room.children as unknown[]).at(-1)).toBe('\u200A');
    expect(room.label).toBe('查看汝窯洗紀錄');
  });

  it('should leave content alone when it ends in an element or in white space', () => {
    const element = <Text>錄</Text>;

    expect(withTrailingRoom(element)).toEqual({ children: element });
    expect(withTrailingRoom('研究紀錄 ')).toEqual({ children: '研究紀錄 ' });
    expect(withTrailingRoom(null)).toEqual({ children: null });
  });
});

describe('rc:GlyphSafeText', () => {
  it('should give serif text trailing room while its accessible name keeps the words', async () => {
    await render(
      <GlyphSafeText testID="label" style={[serif]}>
        研究紀錄
      </GlyphSafeText>,
    );

    expect(screen.getByTestId('label')).toHaveTextContent('研究紀錄\u200A', {
      normalizer: (text) => text,
    });
    expect(screen.getByTestId('label')).toHaveProp(
      'accessibilityLabel',
      '研究紀錄',
    );
  });

  it('should keep the caller accessible name', async () => {
    await render(
      <GlyphSafeText testID="label" style={serif} accessibilityLabel="研究">
        研究紀錄
      </GlyphSafeText>,
    );

    expect(screen.getByTestId('label')).toHaveProp(
      'accessibilityLabel',
      '研究',
    );
  });

  it('should give every bundled serif face room and its bold span the label', async () => {
    await render(
      <GlyphSafeText
        testID="label"
        style={{ fontFamily: bundledFaces.serif.regular }}>
        研究<Text style={{ fontFamily: bundledFaces.serif.bold }}>紀錄</Text>中
      </GlyphSafeText>,
    );

    expect(screen.getByTestId('label')).toHaveProp(
      'accessibilityLabel',
      '研究紀錄中',
    );
  });

  it('should render sans and unstyled text unchanged', async () => {
    await render(
      <>
        <GlyphSafeText testID="sans" style={sans}>
          研究紀錄
        </GlyphSafeText>
        <GlyphSafeText testID="plain">研究紀錄</GlyphSafeText>
      </>,
    );

    for (const id of ['sans', 'plain']) {
      expect(screen.getByTestId(id)).toHaveTextContent('研究紀錄', {
        normalizer: (text) => text,
      });
      expect(screen.getByTestId(id).props.accessibilityLabel).toBeUndefined();
    }
  });
});
