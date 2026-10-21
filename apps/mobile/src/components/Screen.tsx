import {
  KeyboardAvoidingView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { AskAssistantPill, styles, theme } from '@antica/ui';

import { useAskAssistant } from '../providers/AskAssistantProvider';
import { useLocale } from '../providers/LocaleProvider';

import type { FC, PropsWithChildren, ReactNode, Ref } from 'react';

import type { AskContext } from '../features/assistant/ask-context';

export type ScreenProps = PropsWithChildren<{
  title?: string;
  /** small meta line above the title, such as today's date on 今天 */
  overline?: string;
  subtitle?: string;
  scrollable?: boolean;
  /** optional handle for scrolling to content after layout */
  scrollRef?: Ref<ScrollView>;
  /** optional top-bar controls left of the assistant pill, such as search */
  action?: ReactNode;
  /** what the assistant pill attaches when it opens the ask sheet; nothing by default */
  askContext?: AskContext;
  /** the primary action docked under the content, above the tab bar */
  dock?: ReactNode;
}>;

const layout = StyleSheet.create({
  appBar: {
    minHeight: theme.state.appBar.height,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.space[4],
    // the pill's face ends 10 dp from the edge, as in the sheet's top bar
    paddingLeft: theme.space[4],
    paddingRight: theme.space[10],
  },
  heading: { gap: theme.space[4] },
  // the large-head sits directly under the 56 dp top bar, as in the sheet
  underBar: { paddingTop: 0 },
  fixedHeading: { paddingHorizontal: theme.space.page },
  fixedHeadingAlone: { paddingTop: theme.space[8] },
  overline: { ...theme.type.small, color: theme.color.text.tertiary },
  keyboard: { flex: 1 },
  dock: {
    gap: theme.space[6],
    paddingHorizontal: theme.space.page,
    paddingVertical: theme.space[12],
    backgroundColor: theme.color.bg.dock,
    borderTopWidth: theme.border.hairline.width,
    borderTopColor: theme.border.hairline.color,
  },
});

const noContext: AskContext = { kind: 'none' };

/**
 * the assistant pill, labelled in the interface language and attached to its screen
 * @param props pill properties
 * @param props.context what the pill attaches
 * @param props.variant light on paper, or glass over a photo
 * @returns the 48 dp entry that opens the ask sheet, or nothing outside the ask provider
 */
export const AskPill: FC<{
  context: AskContext;
  variant?: 'light' | 'onPhoto';
}> = ({ context, variant }) => {
  const ask = useAskAssistant();

  // a screen outside the ask provider, such as sign-in, has no assistant to label
  return ask ? (
    <LabelledAskPill ask={ask} context={context} variant={variant} />
  ) : null;
};

/**
 * the pill once the ask sheet exists, labelled in the interface language
 * @param props pill properties
 * @param props.ask the shared ask sheet
 * @param props.context what the pill attaches
 * @param props.variant light on paper, or glass over a photo
 * @returns the pill
 */
const LabelledAskPill: FC<{
  ask: NonNullable<ReturnType<typeof useAskAssistant>>;
  context: AskContext;
  variant?: 'light' | 'onPhoto';
}> = ({ ask, context, variant }) => {
  const { t } = useLocale();

  return (
    <AskAssistantPill
      testID="ask-assistant"
      label={t('askAssistant')}
      expanded={ask.context !== null}
      variant={variant}
      onPress={() => ask.open(context)}
    />
  );
};

/**
 * the top bar every screen shares: its own control, then the assistant pill at the right end
 * @param props bar properties
 * @param props.action screen control left of the pill
 * @param props.askContext what the pill attaches
 * @returns the bar, or nothing when a screen has neither a control nor the assistant
 */
const AppBar: FC<Pick<ScreenProps, 'action' | 'askContext'>> = ({
  action,
  askContext = noContext,
}) => {
  const ask = useAskAssistant();
  if (!action && !ask) {
    return null;
  }

  return (
    <View testID="screen-app-bar" style={layout.appBar}>
      {action}
      <AskPill context={askContext} />
    </View>
  );
};

export const Screen: FC<ScreenProps> = ({
  children,
  title,
  overline,
  subtitle,
  scrollable = true,
  scrollRef,
  action,
  askContext,
  dock,
}) => {
  const ask = useAskAssistant();
  // the bar renders whenever the screen has a control or the assistant (see AppBar)
  const underBar = Boolean(action ?? ask);
  const heading = (title || subtitle) && (
    <View style={layout.heading}>
      {overline && <Text style={layout.overline}>{overline}</Text>}
      {title && (
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      )}
      {subtitle && <Text style={styles.secondary}>{subtitle}</Text>}
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'left', 'right']}>
      <AppBar action={action} askContext={askContext} />
      {/* edge-to-edge Android no longer resizes the window for the soft keyboard,
          so both platforms pad the content above it */}
      <KeyboardAvoidingView
        testID="screen-keyboard-frame"
        behavior="padding"
        style={layout.keyboard}>
        {scrollable ? (
          <ScrollView
            ref={scrollRef}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[
              styles.content,
              heading && underBar && layout.underBar,
            ]}>
            {heading}
            {children}
          </ScrollView>
        ) : (
          <>
            {heading && (
              <View
                style={[
                  layout.fixedHeading,
                  !underBar && layout.fixedHeadingAlone,
                ]}>
                {heading}
              </View>
            )}
            {children}
          </>
        )}
        {dock && (
          <View testID="screen-dock" style={layout.dock}>
            {dock}
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
