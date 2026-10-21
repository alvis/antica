import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, theme } from '@antica/ui';

import type { FC } from 'react';

import type { IconName } from '@antica/ui';

/** a section's link at the right end of its header, such as 知識庫 › or ✎ 編輯 */
export type SectionLink = {
  label: string;
  onPress: () => void;
  /** icon before the label; links without one end in a chevron */
  icon?: IconName;
  testID?: string;
};

/** properties for a section header: serif title with a count or links on the right */
export type SectionHeaderProps = {
  title: string;
  /** short count or note on the right, such as 4 項 */
  meta?: string;
  links?: readonly SectionLink[];
  testID?: string;
};

const layout = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space[8],
  },
  title: { ...theme.type.section, color: theme.color.text.primary },
  meta: { ...theme.type.small, color: theme.color.text.tertiary },
  links: { flexDirection: 'row', gap: theme.space[12] },
  link: {
    minHeight: theme.size.hitMin,
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
 * renders a section's serif title with its count or links, as the sheet's `sec-h`
 * @param root0 header properties
 * @param root0.title section title, announced as a header
 * @param root0.meta count or note on the right
 * @param root0.links links on the right
 * @param root0.testID stable automation identifier
 * @returns the header row
 */
export const SectionHeader: FC<SectionHeaderProps> = ({
  title,
  meta,
  links = [],
  testID,
}) => (
  <View testID={testID} style={layout.row}>
    <Text accessibilityRole="header" style={layout.title}>
      {title}
    </Text>
    {meta && <Text style={layout.meta}>{meta}</Text>}
    {links.length > 0 && (
      <View style={layout.links}>
        {links.map((link) => (
          <Pressable
            key={link.label}
            testID={link.testID}
            accessibilityRole="button"
            accessibilityLabel={link.label}
            onPress={link.onPress}
            style={layout.link}>
            {link.icon && (
              <Icon
                name={link.icon}
                size={18}
                color={theme.color.accent.default}
              />
            )}
            <Text style={layout.linkText}>{link.label}</Text>
            {!link.icon && (
              <Icon
                name="chevron"
                size={18}
                color={theme.color.accent.default}
              />
            )}
          </Pressable>
        ))}
      </View>
    )}
  </View>
);
