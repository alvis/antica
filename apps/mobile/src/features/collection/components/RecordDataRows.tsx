import { Fragment } from 'react';

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

/** one piece of a row's value with its own automation identifier, such as the location's label */
export interface RecordDataPart {
  readonly text: string;
  readonly testID?: string;
}

/** one labelled row of 收藏資料 */
export interface RecordDataRow {
  readonly key: string;
  readonly label: string;
  /** the value's pieces, read together with a middle dot between them */
  readonly parts: readonly RecordDataPart[];
  /** a quieter second line, such as how many receipts are attached */
  readonly sub?: string;
  /** opens where the value is changed; a row without it only reads */
  readonly onPress?: () => void;
  /** a label longer than the sheet's two characters needs the wider column */
  readonly wide?: boolean;
}

/** properties for the hub's card of labelled rows */
export type RecordDataRowsProps = {
  rows: readonly RecordDataRow[];
  testID?: string;
};

const layout = StyleSheet.create({
  card: {
    borderRadius: theme.radius.card,
    backgroundColor: theme.color.bg.surface,
    overflow: 'hidden',
    ...theme.elevation.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space[12],
    minHeight: theme.size.rowMin,
    paddingVertical: theme.space[12],
    paddingLeft: theme.space[14],
    paddingRight: theme.space[8],
  },
  rule: {
    borderTopWidth: theme.border.hairline.width,
    borderTopColor: theme.border.hairline.color,
  },
  pressed: { backgroundColor: theme.color.card.pressed },
  label: {
    width: 44,
    paddingTop: theme.space[2],
    ...theme.type.small,
    color: theme.color.text.tertiary,
  },
  wide: { width: 72 },
  value: { flex: 1 },
  parts: { flexDirection: 'row', flexWrap: 'wrap' },
  text: {
    ...theme.font.face('sans', '400'),
    fontSize: 15,
    lineHeight: 23.3,
    color: theme.color.text.primary,
  },
  sub: {
    ...theme.type.micro,
    ...theme.font.face('sans', '400'),
    lineHeight: 18,
    color: theme.color.text.tertiary,
  },
});

/**
 * the record's collection details as labelled rows in one card; rows that open the editor end
 * in a chevron
 * @param root0 card properties
 * @param root0.rows rows in display order
 * @param root0.testID stable automation identifier
 * @returns the card
 */
export const RecordDataRows: FC<RecordDataRowsProps> = ({ rows, testID }) => {
  const { t } = useLocale();

  return (
    <View testID={testID} style={layout.card}>
      {rows.map((row, index) => {
        const content = (
          <>
            <Text style={[layout.label, row.wide && layout.wide]}>
              {row.label}
            </Text>
            <View style={layout.value}>
              <View style={layout.parts}>
                {row.parts.map((part, partIndex) => (
                  <Fragment key={part.testID ?? partIndex}>
                    {/* the dot is its own text, so each piece reads exactly as saved */}
                    {partIndex > 0 && (
                      <Text style={layout.text}>{t('metaSeparator')}</Text>
                    )}
                    <Text testID={part.testID} style={layout.text}>
                      {part.text}
                    </Text>
                  </Fragment>
                ))}
              </View>
              {row.sub && <Text style={layout.sub}>{row.sub}</Text>}
            </View>
            {row.onPress && (
              <Icon
                name="chevron"
                size={18}
                color={theme.color.text.tertiary}
              />
            )}
          </>
        );
        const style = [layout.row, index > 0 && layout.rule];
        const spoken = [
          row.label,
          ...row.parts.map((part) => part.text),
          row.sub,
        ]
          .filter(Boolean)
          .join(t('spokenSeparator'));

        return row.onPress ? (
          <Pressable
            key={row.key}
            accessibilityRole="button"
            accessibilityLabel={spoken}
            onPress={row.onPress}
            style={({ pressed }) => [...style, pressed && layout.pressed]}>
            {content}
          </Pressable>
        ) : (
          <View key={row.key} style={style}>
            {content}
          </View>
        );
      })}
    </View>
  );
};
