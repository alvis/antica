import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge, Icon, theme } from '@antica/ui';

import { RecordPhoto } from '../../../components/RecordPhoto';

import type { FC } from 'react';

import type { BadgeTone } from '@antica/ui';

/** properties for one compact inbox card */
export type InboxRowCardProps = {
  name: string;
  photoUri: string | null | undefined;
  /** status chip, such as 2 項修改待確認 or 需要補拍 */
  chip: string;
  chipTone: BadgeTone;
  /** why it waits, in the assistant's words */
  why: string;
  /** opens what waits: the conversation, or the record */
  onOpen: () => void;
  /** a camera shortcut beside the card instead of the chevron */
  capture?: { label: string; onPress: () => void };
  testID?: string;
};

const layout = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[12],
    padding: theme.space[12],
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.card,
    ...theme.elevation.card,
  },
  withCapture: { paddingRight: theme.space[8] },
  open: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[12],
  },
  pressed: { opacity: 0.7 },
  photo: { width: 72, height: 72, borderRadius: theme.radius.photo },
  text: { flex: 1, minWidth: 0 },
  name: {
    ...theme.font.face('serif', '700'),
    fontSize: 16,
    lineHeight: 21.6,
    color: theme.color.text.primary,
    marginTop: theme.space[4],
  },
  why: {
    ...theme.font.face('sans', '400'),
    fontSize: 14,
    lineHeight: 21,
    color: theme.color.text.secondary,
    marginTop: theme.space[2],
  },
  camera: {
    width: theme.size.iconButton,
    height: theme.size.iconButton,
    borderRadius: theme.size.iconButton / 2,
    borderWidth: theme.border.control.width,
    borderColor: theme.border.control.color,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * one compact inbox card: photo, status chip, serif name and the reason, ending in a chevron
 * or a camera shortcut
 * @param root0 card properties
 * @param root0.name record name
 * @param root0.photoUri the record's cover photo
 * @param root0.chip status chip
 * @param root0.chipTone chip colour role
 * @param root0.why why it waits
 * @param root0.onOpen opens what waits
 * @param root0.capture camera shortcut
 * @param root0.testID stable automation identifier
 * @returns the card
 */
export const InboxRowCard: FC<InboxRowCardProps> = ({
  name,
  photoUri,
  chip,
  chipTone,
  why,
  onOpen,
  capture,
  testID,
}) => (
  <View testID={testID} style={[layout.card, capture && layout.withCapture]}>
    <Pressable
      testID={testID && `${testID}-open`}
      accessibilityRole="button"
      accessibilityLabel={`${chip}，${name}。${why}`}
      onPress={onOpen}
      style={({ pressed }) => [layout.open, pressed && layout.pressed]}>
      <RecordPhoto uri={photoUri} style={layout.photo} />
      <View style={layout.text}>
        <Badge label={chip} tone={chipTone} />
        <Text style={layout.name}>{name}</Text>
        <Text style={layout.why}>{why}</Text>
      </View>
      {!capture && <Icon name="chevron" color={theme.color.text.tertiary} />}
    </Pressable>
    {capture && (
      <Pressable
        testID={testID && `${testID}-capture`}
        accessibilityRole="button"
        accessibilityLabel={capture.label}
        onPress={capture.onPress}
        style={({ pressed }) => [layout.camera, pressed && layout.pressed]}>
        <Icon name="camera" />
      </Pressable>
    )}
  </View>
);
