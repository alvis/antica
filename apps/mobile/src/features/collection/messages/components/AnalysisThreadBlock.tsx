import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { AssistantSeal, Icon, theme } from '@antica/ui';

import { RecordPhoto } from '../../../../components/RecordPhoto';
import { useLocale } from '../../../../providers/LocaleProvider';

import type { FC } from 'react';

/** properties for the latest analysis inside the conversation */
export type AnalysisThreadBlockProps = {
  /** queued or running shows progress; finished links to the suggestions; failed says so */
  phase: 'queued' | 'running' | 'finished' | 'failed';
  /** signed reads of the analysed photos, at most six shown */
  photoUris: ReadonlyArray<string | undefined>;
  /** how many photos the analysis read */
  photoCount: number;
  /** how many videos the analysis read */
  videoCount: number;
  /** suggestions the finished analysis made */
  suggestionCount: number;
  onOpenSuggestions: () => void;
};

/** photos the collector's side of the block shows before counting the rest */
const shownPhotos = 6;

const layout = StyleSheet.create({
  block: { gap: theme.space.page },
  mine: { alignSelf: 'flex-end', alignItems: 'flex-end', gap: theme.space[6] },
  grid: {
    width: 72 * 3 + 4 * 2,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  photo: { width: 72, height: 72, borderRadius: theme.radius.photo * 0.6 },
  more: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(10,10,10,0.58)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreText: {
    ...theme.font.face('sans', '600'),
    fontSize: 15,
    color: '#FFFFFF',
  },
  meta: { ...theme.type.small, color: theme.color.text.tertiary },
  ai: { flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[10] },
  column: { flex: 1, minWidth: 0, gap: theme.space.stack },
  text: {
    ...theme.type.chat,
    paddingTop: theme.space[2],
    color: theme.color.text.primary,
  },
  card: {
    overflow: 'hidden',
    borderRadius: theme.radius.card,
    borderWidth: theme.border.hairline.width,
    borderColor: theme.border.hairline.color,
    backgroundColor: theme.color.bg.surface,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[8],
    paddingVertical: theme.space[12],
    paddingHorizontal: theme.space[16],
    borderBottomWidth: theme.border.hairline.width,
    borderBottomColor: theme.border.hairline.color,
  },
  headText: {
    flex: 1,
    ...theme.font.face('sans', '600'),
    fontSize: 15,
    lineHeight: 21,
    color: theme.color.text.primary,
  },
  estimate: { ...theme.type.small, color: theme.color.text.tertiary },
  spin: {
    borderWidth: 2,
    borderColor: theme.color.accent.default,
    borderRightColor: 'transparent',
  },
  steps: {
    paddingVertical: theme.space[12],
    paddingHorizontal: theme.space[16],
    gap: theme.space[10],
  },
  stepGroup: { gap: theme.space[10] },
  step: { flexDirection: 'row', alignItems: 'center', gap: theme.space[10] },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotDone: { backgroundColor: theme.color.accent.default },
  dotTodo: { borderWidth: 1.5, borderColor: theme.color.border.strong },
  stepText: { ...theme.type.body2, color: theme.color.text.secondary },
  stepNow: {
    ...theme.font.face('sans', '600'),
    color: theme.color.text.primary,
  },
  progress: {
    height: 4,
    borderRadius: 2,
    marginLeft: 30,
    overflow: 'hidden',
    backgroundColor: theme.color.bg.sunken,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: theme.color.accent.default,
  },
  note: {
    ...theme.type.small,
    color: theme.color.text.tertiary,
    paddingTop: theme.space[10],
    paddingHorizontal: theme.space[16],
    paddingBottom: theme.space[12],
  },
  link: {
    minHeight: theme.size.hitMin,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[2],
  },
  linkText: {
    ...theme.font.face('sans', '600'),
    fontSize: 14,
    lineHeight: 19.6,
    color: theme.color.accent.default,
  },
});

/**
 * the v5 `.spin` ring: three quarters of a circle turning once a second
 * @param props spinner properties
 * @param props.size outer diameter
 * @returns the spinner
 */
const Spinner: FC<{ size: number }> = ({ size }) => {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();

    return () => loop.stop();
  }, [turn]);
  const rotate = turn.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <Animated.View
      style={[
        layout.spin,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          transform: [{ rotate }],
        },
      ]}
    />
  );
};

/** the analysis steps the progress card lists, in order */
const stepKeys = [
  'analysisStepRead',
  'analysisStepObserve',
  'analysisStepSuggest',
] as const;

/**
 * the latest analysis in the 對話 segment (v2 in-thread): while it runs, the photos it read and a
 * progress card; once done, a line with the way to its suggestions
 * @param props block properties
 * @param props.phase where the analysis stands
 * @param props.photoUris the analysed photos
 * @param props.photoCount how many photos it read
 * @param props.videoCount how many videos it read
 * @param props.suggestionCount suggestions the finished analysis made
 * @param props.onOpenSuggestions opens the 建議 segment
 * @returns the block
 */
export const AnalysisThreadBlock: FC<AnalysisThreadBlockProps> = ({
  phase,
  photoUris,
  photoCount,
  videoCount,
  suggestionCount,
  onOpenSuggestions,
}) => {
  const { t } = useLocale();
  const running = phase === 'queued' || phase === 'running';
  const done = 1;
  const status = t(phase === 'queued' ? 'queued' : 'analysisRunning');
  const extra = Math.max(0, photoCount + videoCount - shownPhotos);
  const photos =
    photoCount > 0 ? t('historyPhotos', { count: photoCount }) : '';
  const videos =
    videoCount > 0 ? t('historyVideos', { count: videoCount }) : '';
  // v5 lists them with 、 under the photos and joins them with 與 in the step
  const listed = [photos, videos].filter(Boolean).join(t('listSeparator'));
  const joined =
    photos && videos
      ? t('analysisMediaAnd', { photos, videos })
      : photos || videos;

  return (
    <View testID={`record-analysis-thread-${phase}`} style={layout.block}>
      {running && (
        <View style={layout.mine}>
          <View style={layout.grid}>
            {photoUris.slice(0, shownPhotos).map((uri, index) => (
              <RecordPhoto key={index} uri={uri} style={layout.photo}>
                {index === shownPhotos - 1 && extra > 0 && (
                  <View style={layout.more}>
                    <Text style={layout.moreText}>+{extra}</Text>
                  </View>
                )}
              </RecordPhoto>
            ))}
          </View>
          <Text style={layout.meta}>
            {t('analysisFilesUploaded', { files: listed })}
          </Text>
        </View>
      )}
      <View style={layout.ai}>
        <AssistantSeal size="voice" />
        <View style={layout.column}>
          <Text style={layout.text}>
            {running
              ? t('analysisReceived')
              : phase === 'failed'
                ? t('analysisFailed')
                : t('analysisFinishedLine', { count: suggestionCount })}
          </Text>
          {running ? (
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityState={{ busy: true }}
              accessibilityValue={{ text: status }}
              style={layout.card}>
              <View style={layout.head}>
                <Spinner size={18} />
                <Text style={layout.headText}>{status}</Text>
                <Text style={layout.estimate}>{t('analysisEstimate')}</Text>
              </View>
              <View style={layout.steps}>
                {stepKeys.map((key, index) => {
                  const state =
                    phase === 'queued'
                      ? 'todo'
                      : index < done
                        ? 'done'
                        : index === done
                          ? 'now'
                          : 'todo';

                  return (
                    <View key={key} style={layout.stepGroup}>
                      <View style={layout.step}>
                        <View
                          testID={`analysis-step-${index}-${state}`}
                          style={[
                            layout.dot,
                            state === 'done' && layout.dotDone,
                            state === 'todo' && layout.dotTodo,
                          ]}>
                          {state === 'done' ? (
                            <Icon
                              name="check"
                              size={16}
                              color={theme.color.bg.surface}
                            />
                          ) : state === 'now' ? (
                            <Spinner size={16} />
                          ) : null}
                        </View>
                        <Text
                          style={[
                            layout.stepText,
                            state === 'now' && layout.stepNow,
                          ]}>
                          {key === 'analysisStepRead'
                            ? t(key, { files: joined })
                            : t(key)}
                        </Text>
                      </View>
                      {/* v5 keeps the bar under the step that is running */}
                      {state === 'now' && (
                        <View style={layout.progress}>
                          <View
                            style={[
                              layout.progressFill,
                              {
                                width: `${Math.round(((done + 0.5) / stepKeys.length) * 100)}%`,
                              },
                            ]}
                          />
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>
              <Text style={layout.note}>{t('analysisLeaveNote')}</Text>
            </View>
          ) : (
            phase === 'finished' &&
            suggestionCount > 0 && (
              <Pressable
                testID="analysis-open-suggestions"
                accessibilityRole="link"
                onPress={onOpenSuggestions}
                style={layout.link}>
                <Text style={layout.linkText}>
                  {t('analysisOpenSuggestions', { count: suggestionCount })}
                </Text>
                <Icon
                  name="chevron"
                  size={18}
                  color={theme.color.accent.default}
                />
              </Pressable>
            )
          )}
        </View>
      </View>
    </View>
  );
};
