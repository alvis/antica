import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, theme } from '@antica/ui';

import { RecordPhoto } from '../../../components/RecordPhoto';

import type { FC } from 'react';

/** properties for the feature card of a record whose analysis just finished */
export type InboxFeatureCardProps = {
  name: string;
  photoUri: string | null | undefined;
  /** chip on the photo, such as 分析完成 */
  chip: string;
  /** finish time, such as 下午 2:46 */
  time?: string;
  /** what the analysis produced and what waits */
  summary: string;
  /** the link line, such as 逐項檢視 */
  linkLabel: string;
  onPress: () => void;
  testID?: string;
};

const layout = StyleSheet.create({
  card: {
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.card,
    overflow: 'hidden',
    ...theme.elevation.card,
  },
  pressed: { backgroundColor: theme.color.card.pressed },
  photo: { height: 172 },
  chip: {
    position: 'absolute',
    left: theme.space[12],
    top: theme.space[12],
    minHeight: 24,
    paddingHorizontal: theme.space[8],
    borderRadius: theme.radius.chip,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[4],
    backgroundColor: theme.color.photo.chip,
  },
  chipText: { ...theme.type.micro, color: theme.color.photo.onChip },
  body: { padding: theme.space.card },
  head: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: theme.space[8],
  },
  name: { ...theme.type.heading, color: theme.color.text.primary, flex: 1 },
  time: { ...theme.type.small, color: theme.color.text.tertiary },
  summary: {
    ...theme.type.body2,
    color: theme.color.text.secondary,
    marginTop: theme.space[4],
  },
  link: {
    minHeight: 32,
    marginTop: theme.space[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
  },
  linkText: {
    ...theme.font.face('sans', '600'),
    fontSize: 14,
    color: theme.color.accent.default,
  },
});

/**
 * the large inbox card for a finished analysis: photo with its chip, name, time, summary and link
 * @param root0 card properties
 * @param root0.name record name
 * @param root0.photoUri the record's cover photo
 * @param root0.chip chip on the photo
 * @param root0.time finish time
 * @param root0.summary what the analysis produced
 * @param root0.linkLabel the link line
 * @param root0.onPress opens the suggestions
 * @param root0.testID stable automation identifier
 * @returns one pressable card
 */
export const InboxFeatureCard: FC<InboxFeatureCardProps> = ({
  name,
  photoUri,
  chip,
  time,
  summary,
  linkLabel,
  onPress,
  testID,
}) => (
  <Pressable
    testID={testID}
    accessibilityRole="button"
    accessibilityLabel={`${chip}，${name}。${summary}`}
    onPress={onPress}
    style={({ pressed }) => [layout.card, pressed && layout.pressed]}>
    <RecordPhoto uri={photoUri} style={layout.photo}>
      <View style={layout.chip}>
        <Icon name="check" size={16} color={theme.color.photo.onChip} />
        <Text style={layout.chipText}>{chip}</Text>
      </View>
    </RecordPhoto>
    <View style={layout.body}>
      <View style={layout.head}>
        <Text style={layout.name}>{name}</Text>
        {time && <Text style={layout.time}>{time}</Text>}
      </View>
      <Text style={layout.summary}>{summary}</Text>
      <View style={layout.link}>
        <Text style={layout.linkText}>{linkLabel}</Text>
        <Icon name="chevron" size={18} color={theme.color.accent.default} />
      </View>
    </View>
  </Pressable>
);
