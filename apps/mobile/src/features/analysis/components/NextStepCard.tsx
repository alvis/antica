import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, theme } from '@antica/ui';

import { RecordPhoto } from '../../../components/RecordPhoto';
import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { IconName } from '@antica/ui';

/** properties for one 下一步 card under the suggestions */
export type NextStepCardProps = {
  /** what to do, such as 拍攝底足與支釘痕 */
  title: string;
  /** why, in the assistant's words */
  reason: string;
  icon: IconName;
  /** An object photo illustrating a requested capture. */
  photoUri?: string;
  onPress: () => void;
  testID?: string;
};

const layout = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[12],
    marginTop: theme.space.stack,
    marginHorizontal: theme.space.page,
    padding: theme.space[12],
    borderRadius: theme.radius.card,
    backgroundColor: theme.color.bg.surface,
    ...theme.elevation.card,
  },
  pressed: { backgroundColor: theme.color.card.pressed },
  tile: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.photo * 0.7,
    backgroundColor: theme.color.bg.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photo: {
    width: 64,
    height: 64,
    transform: [{ rotate: '-16deg' }, { scale: 1.15 }],
  },
  text: { flex: 1, minWidth: 0 },
  title: {
    ...theme.font.face('sans', '700'),
    fontSize: 15,
    lineHeight: 21,
    color: theme.color.text.primary,
  },
  reason: {
    ...theme.type.small,
    color: theme.color.text.secondary,
  },
});

/**
 * a 下一步 card (v5 `.next`): what the analysis asks for next and why, opening the capture or
 * description it needs
 * @param props card properties
 * @param props.title what to do
 * @param props.reason why
 * @param props.icon the step's icon
 * @param props.photoUri the object photo illustrating the capture
 * @param props.onPress starts the step
 * @param props.testID stable automation identifier
 * @returns the card
 */
export const NextStepCard: FC<NextStepCardProps> = ({
  title,
  reason,
  icon,
  photoUri,
  onPress,
  testID,
}) => {
  const { t } = useLocale();

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${title}${t('spokenSeparator')}${reason}`}
      onPress={onPress}
      style={({ pressed }) => [layout.card, pressed && layout.pressed]}>
      <View style={layout.tile}>
        {photoUri ? (
          <RecordPhoto uri={photoUri} style={layout.photo} />
        ) : (
          <Icon name={icon} color={theme.color.text.secondary} />
        )}
      </View>
      <View style={layout.text}>
        <Text style={layout.title}>{title}</Text>
        <Text style={layout.reason}>{reason}</Text>
      </View>
      <Icon name="chevron" size={18} color={theme.color.text.tertiary} />
    </Pressable>
  );
};
