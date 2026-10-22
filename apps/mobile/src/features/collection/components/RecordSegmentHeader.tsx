import { StyleSheet, Text, View } from 'react-native';

import { SegmentControl, theme } from '@antica/ui';

import { IconButton } from '../../../components/IconButton';
import { RecordPhoto } from '../../../components/RecordPhoto';
import { AskPill } from '../../../components/Screen';
import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

import type { AskContext } from '../../assistant/ask-context';

/** the record's segments in the order the bar shows them (v5: 資料 · 查驗 · 建議 · 對話 · 紀錄) */
export type RecordSegment =
  'data' | 'checks' | 'suggestions' | 'chat' | 'history';

/** properties for the compact record header the 建議, 對話 and 紀錄 segments share */
export type RecordSegmentHeaderProps = {
  /** the record's name, else its code */
  name: string;
  /** one line under the name, such as when the analysis finished */
  subtitle?: string;
  /** signed read of the record's cover photo */
  coverUri?: string;
  /** the segment on screen */
  current: Extract<RecordSegment, 'suggestions' | 'chat' | 'history'>;
  /** suggestions still waiting on the collector, shown on 建議 */
  suggestionCount?: number;
  /** whether 建議 has a run to open */
  canOpenSuggestions: boolean;
  askContext: AskContext;
  onBack: () => void;
  onSegment: (segment: RecordSegment) => void;
};

const layout = StyleSheet.create({
  header: {
    backgroundColor: theme.color.bg.page,
    borderBottomWidth: theme.border.hairline.width,
    borderBottomColor: theme.border.hairline.color,
    paddingBottom: theme.space[10],
  },
  row: {
    height: theme.size.appBar,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[4],
    paddingLeft: theme.space[4],
    paddingRight: theme.space[6],
  },
  object: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[10],
  },
  cover: { width: 40, height: 40, borderRadius: theme.radius.photo * 0.7 },
  text: { flex: 1, minWidth: 0 },
  name: {
    ...theme.font.face('serif', '700'),
    fontSize: 17,
    lineHeight: 22.1,
    color: theme.color.text.primary,
  },
  subtitle: {
    ...theme.font.face('sans', '400'),
    fontSize: 12,
    lineHeight: 18,
    color: theme.color.text.tertiary,
  },
  segments: { marginTop: theme.space[2], paddingHorizontal: theme.space.page },
});

/**
 * the compact record header (v5 `.compact`): back, the cover photo with the name and a status line,
 * the assistant pill, and the segment bar with the current segment marked
 * @param props header properties
 * @param props.name the record's name
 * @param props.subtitle the status line under the name
 * @param props.coverUri the cover photo
 * @param props.current the segment on screen
 * @param props.suggestionCount suggestions waiting on the collector
 * @param props.canOpenSuggestions whether 建議 has a run to open
 * @param props.askContext what the assistant pill attaches
 * @param props.onBack leaves the segment
 * @param props.onSegment opens another segment
 * @returns the header
 */
export const RecordSegmentHeader: FC<RecordSegmentHeaderProps> = ({
  name,
  subtitle,
  coverUri,
  current,
  suggestionCount,
  canOpenSuggestions,
  askContext,
  onBack,
  onSegment,
}) => {
  const { t } = useLocale();

  return (
    <View testID="record-segment-header" style={layout.header}>
      <View style={layout.row}>
        <IconButton
          testID="record-segment-back"
          icon="back"
          label={t('back')}
          onPress={onBack}
        />
        <View style={layout.object}>
          <RecordPhoto uri={coverUri} style={layout.cover} />
          <View style={layout.text}>
            <Text
              accessibilityRole="header"
              numberOfLines={1}
              style={layout.name}>
              {name}
            </Text>
            {subtitle ? (
              <Text
                testID="record-segment-subtitle"
                numberOfLines={1}
                style={layout.subtitle}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        <AskPill context={askContext} />
      </View>
      <View style={layout.segments}>
        <SegmentControl<RecordSegment>
          testID="record-segments"
          accessibilityLabel={t('recordSegmentsLabel')}
          value={current}
          onChange={onSegment}
          options={[
            {
              value: 'data',
              label: t('recordSegData'),
              navigates: true,
              testID: 'record-segment-data',
            },
            {
              value: 'checks',
              label: t('recordSegChecks'),
              navigates: true,
              testID: 'record-segment-checks',
            },
            {
              value: 'suggestions',
              label: t('recordSegSuggestions'),
              badge: suggestionCount || undefined,
              disabled: !canOpenSuggestions,
              navigates: current !== 'suggestions',
              testID: 'record-segment-suggestions',
            },
            {
              value: 'chat',
              label: t('recordSegChat'),
              navigates: current !== 'chat',
              testID: 'record-segment-chat',
            },
            {
              value: 'history',
              label: t('recordSegHistory'),
              navigates: current !== 'history',
              testID: 'record-segment-history',
            },
          ]}
        />
      </View>
    </View>
  );
};
