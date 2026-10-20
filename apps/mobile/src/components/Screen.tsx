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
import type { AskAssistantState } from '../providers/AskAssistantProvider';

export type ScreenProps = PropsWithChildren<{
  title?: string;
  subtitle?: string;
  scrollable?: boolean;
  /** optional handle for scrolling to content after layout */
  scrollRef?: Ref<ScrollView>;
  /** optional top-bar control left of the assistant pill, such as the Settings gear */
  action?: ReactNode;
  /** what the assistant pill attaches when it opens the ask sheet; nothing by default */
  askContext?: AskContext;
}>;

const layout = StyleSheet.create({
  appBar: {
    minHeight: theme.state.appBar.height,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: theme.space[4],
    paddingHorizontal: theme.space.page,
  },
  heading: { gap: theme.space[4] },
  keyboard: { flex: 1 },
});

const noContext: AskContext = { kind: 'none' };

/**
 * the assistant pill, labelled in the interface language and attached to its screen
 * @param props pill properties
 * @param props.ask the shared ask sheet
 * @param props.context what the pill attaches
 * @returns the 48 dp entry that opens the ask sheet
 */
const AskPill: FC<{ ask: AskAssistantState; context: AskContext }> = ({
  ask,
  context,
}) => {
  const { t } = useLocale();

  return (
    <AskAssistantPill
      testID="ask-assistant"
      label={t('askAssistant')}
      expanded={ask.context !== null}
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
      {ask && <AskPill ask={ask} context={askContext} />}
    </View>
  );
};

export const Screen: FC<ScreenProps> = ({
  children,
  title,
  subtitle,
  scrollable = true,
  scrollRef,
  action,
  askContext,
}) => {
  const heading = (title || subtitle) && (
    <View style={layout.heading}>
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
            contentContainerStyle={styles.content}>
            {heading}
            {children}
          </ScrollView>
        ) : (
          <>
            {heading && (
              <View
                style={{
                  paddingHorizontal: theme.space.page,
                  paddingTop: theme.space[8],
                }}>
                {heading}
              </View>
            )}
            {children}
          </>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};
