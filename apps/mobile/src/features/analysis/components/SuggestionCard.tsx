import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon, theme } from '@antica/ui';

import { RecordPhoto } from '../../../components/RecordPhoto';
import { localizeProposalField } from '../../../i18n/messages';
import { useLocale } from '../../../providers/LocaleProvider';

import { angleLabel } from '../../collection/record-hub';

import { ExampleChip } from './ExampleChip';
import { SuggestionConfidence } from './SuggestionConfidence';

import type { FC } from 'react';

import type { CitedEntry } from '../hooks/useCitedEntries';
import type { Suggestion } from '../suggestions';

/** properties for one field suggestion on the 建議 segment */
export type SuggestionCardProps = {
  suggestion: Suggestion;
  /** the field's value before the suggestion, as text */
  beforeText: string;
  /** the suggested value, as text */
  proposedText: string;
  /** the field's value now, named when the suggestion went stale */
  currentText: string;
  /** the museum example behind the suggestion's first cited source, once found */
  example?: CitedEntry;
  checked: boolean;
  /** whether the collector can tick it now: open, with the record read and nothing being saved */
  canTick: boolean;
  /** whether the card was opened from the record's change history */
  focused?: boolean;
  onToggle: () => void;
  onDiscuss: () => void;
  onOpenPhoto: (assetId: string, anchorId: string) => void;
  onOpenExample: (example: CitedEntry) => void;
};

const card = {
  photo: theme.radius.photo * 0.7,
} as const;

const layout = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: theme.space[4],
    marginTop: theme.space.stack,
    marginHorizontal: theme.space.page,
    paddingTop: theme.space[12],
    paddingRight: 14,
    paddingBottom: 14,
    paddingLeft: theme.space[4],
    borderRadius: theme.radius.card,
    backgroundColor: theme.color.bg.surface,
    ...theme.elevation.card,
  },
  stale: {
    backgroundColor: 'transparent',
    boxShadow: undefined,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: theme.color.border.strong,
  },
  focused: { borderWidth: 2, borderColor: theme.color.accent.default },
  tick: {
    width: theme.size.hitMin,
    height: theme.size.hitMin,
    marginTop: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  box: {
    width: 24,
    height: 24,
    borderRadius: theme.radius.chip * 0.5 + 2,
    borderWidth: 2,
    borderColor: theme.color.text.tertiary,
    backgroundColor: theme.color.bg.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxChecked: {
    backgroundColor: theme.color.action.primary,
    borderColor: theme.color.action.primary,
  },
  boxStale: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  boxDone: {
    backgroundColor: theme.color.bg.sunken,
    borderColor: theme.color.border.strong,
  },
  body: { flex: 1, minWidth: 0 },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: theme.space[8],
  },
  field: {
    ...theme.font.face('sans', '600'),
    fontSize: 13,
    lineHeight: 18.2,
    color: theme.color.text.tertiary,
  },
  tag: {
    minHeight: 22,
    paddingHorizontal: theme.space[8],
    borderRadius: theme.radius.chip,
    backgroundColor: theme.color.bg.sunken,
    justifyContent: 'center',
  },
  tagText: {
    ...theme.font.face('sans', '700'),
    fontSize: 12,
    lineHeight: 16,
    color: theme.color.text.secondary,
  },
  before: {
    ...theme.type.small,
    marginTop: theme.space[2],
    color: theme.color.text.tertiary,
  },
  proposed: {
    ...theme.type.suggestValue,
    marginTop: theme.space[2],
    color: theme.color.text.primary,
  },
  proposedStale: { color: theme.color.text.secondary },
  reason: {
    ...theme.type.body2,
    lineHeight: 21.7,
    marginTop: theme.space[6],
    color: theme.color.text.secondary,
  },
  staleNote: {
    flexDirection: 'row',
    gap: theme.space[8],
    marginTop: theme.space[8],
    paddingVertical: theme.space[10],
    paddingHorizontal: theme.space[12],
    borderRadius: theme.radius.field,
    backgroundColor: theme.color.status.warningSoft,
  },
  staleText: {
    flex: 1,
    ...theme.type.small,
    color: theme.color.status.warning,
  },
  evidence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[8],
    marginTop: theme.space[10],
  },
  photo: { width: 56, alignItems: 'center' },
  photoFrame: { width: 56, height: 56, borderRadius: card.photo },
  photoLabel: {
    marginTop: theme.space[4],
    ...theme.font.face('sans', '400'),
    fontSize: 12,
    lineHeight: 15.6,
    color: theme.color.text.tertiary,
    textAlign: 'center',
  },
  foot: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: theme.space[8],
    marginRight: -6,
  },
  discuss: {
    minHeight: theme.size.hitMin,
    paddingHorizontal: theme.space[12],
    borderRadius: theme.radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[6],
    backgroundColor: theme.color.assistant.soft,
  },
  discussText: {
    ...theme.font.face('sans', '600'),
    fontSize: 14,
    lineHeight: 19.6,
    color: theme.color.assistant.onSoft,
  },
  pressed: { opacity: 0.75 },
});

/** the tag a decided or stale suggestion carries in place of its tick */
const stateTags = {
  stale: 'suggestionStale',
  accepted: 'suggestionAccepted',
  skipped: 'suggestionSkipped',
} as const;

/**
 * a suggestion card (v5 `.sug`): an empty tick the collector sets, the field, its value now and the
 * suggested one, the reason with its photos and museum example, and 討論這項; a stale suggestion is
 * dashed, cannot be ticked and says why
 * @param props card properties
 * @param props.suggestion the suggestion with its state and evidence
 * @param props.beforeText the value before, as text
 * @param props.proposedText the suggested value, as text
 * @param props.currentText the value now, as text
 * @param props.example the museum example behind it
 * @param props.checked whether the collector ticked it
 * @param props.canTick whether it can be ticked now
 * @param props.focused whether it was opened from the change history
 * @param props.onToggle ticks or unticks it
 * @param props.onDiscuss opens 對話 with the suggestion attached
 * @param props.onOpenPhoto opens an evidence photo
 * @param props.onOpenExample opens the museum example
 * @returns the card
 */
export const SuggestionCard: FC<SuggestionCardProps> = ({
  suggestion,
  beforeText,
  proposedText,
  currentText,
  example,
  checked,
  canTick,
  focused = false,
  onToggle,
  onDiscuss,
  onOpenPhoto,
  onOpenExample,
}) => {
  const { t } = useLocale();
  const { change, state } = suggestion;
  const field = localizeProposalField(change.field, t);
  const stale = state === 'stale';
  const open = state === 'open';
  const tag = state === 'open' ? undefined : t(stateTags[state]);

  return (
    <View
      testID={`analysis-suggestion-${change.id}`}
      style={[layout.card, stale && layout.stale, focused && layout.focused]}>
      <Pressable
        testID={`analysis-proposal-${change.id}`}
        accessibilityRole="checkbox"
        accessibilityLabel={
          stale
            ? t('suggestionStaleLabel', { field })
            : t('suggestionTickLabel', { field })
        }
        // the marker is a hint, not a selected state, so it never reads as a preselection
        accessibilityHint={focused ? t('openedFromHistory') : undefined}
        accessibilityState={{
          checked: checked || state === 'accepted',
          disabled: !open || !canTick,
        }}
        disabled={!open || !canTick}
        onPress={onToggle}
        style={layout.tick}>
        <View
          style={[
            layout.box,
            checked && layout.boxChecked,
            stale && layout.boxStale,
            (state === 'accepted' || state === 'skipped') && layout.boxDone,
          ]}>
          {(checked || state === 'accepted') && (
            <Icon
              name="check"
              size={16}
              color={
                checked
                  ? theme.color.action.onPrimary
                  : theme.color.text.tertiary
              }
            />
          )}
        </View>
      </Pressable>
      <View style={layout.body}>
        <View style={layout.fieldRow}>
          <Text style={layout.field}>{field}</Text>
          {!tag && <SuggestionConfidence confidence={change.confidence} />}
          {tag && (
            <View
              testID={`analysis-suggestion-state-${state}-${change.id}`}
              style={layout.tag}>
              <Text style={layout.tagText}>{tag}</Text>
            </View>
          )}
        </View>
        <Text style={layout.before}>
          {t(stale ? 'suggestionBeforeWhenMade' : 'suggestionCurrent', {
            value: beforeText,
          })}
        </Text>
        <Text style={[layout.proposed, stale && layout.proposedStale]}>
          {proposedText}
        </Text>
        {suggestion.reasons.map((reason) => (
          <Text key={reason} style={layout.reason}>
            {reason}
          </Text>
        ))}
        {stale && (
          <View style={layout.staleNote}>
            <Icon name="info" size={18} color={theme.color.status.warning} />
            <Text style={layout.staleText}>
              {/* a field changed to the suggested value needs nothing more, so it is no conflict */}
              {currentText === proposedText
                ? t('suggestionHeldNote', { field })
                : t('suggestionStaleNote', { field, value: currentText })}
            </Text>
          </View>
        )}
        {(suggestion.photos.length > 0 || example) && (
          <View style={layout.evidence}>
            {suggestion.photos.map((photo) => {
              const angle = angleLabel(photo.fileName);

              return (
                <Pressable
                  key={photo.assetId}
                  testID={`analysis-suggestion-photo-${change.id}-${photo.assetId}`}
                  accessibilityRole="button"
                  accessibilityLabel={t('suggestionEvidencePhoto', {
                    angle: angle ?? photo.fileName,
                  })}
                  onPress={() => onOpenPhoto(photo.assetId, photo.anchorId)}
                  style={({ pressed }) => [
                    layout.photo,
                    pressed && layout.pressed,
                  ]}>
                  <RecordPhoto uri={photo.uri} style={layout.photoFrame} />
                  {angle && <Text style={layout.photoLabel}>{angle}</Text>}
                </Pressable>
              );
            })}
            {example && (
              <ExampleChip
                testID={`analysis-suggestion-example-${change.id}`}
                example={example}
                onOpen={onOpenExample}
              />
            )}
          </View>
        )}
        <View style={layout.foot}>
          <Pressable
            testID={`analysis-discuss-${change.id}`}
            accessibilityRole="button"
            accessibilityLabel={t('suggestionDiscussLabel', { field })}
            onPress={onDiscuss}
            style={({ pressed }) => [
              layout.discuss,
              pressed && layout.pressed,
            ]}>
            <Icon name="chat" size={18} color={theme.color.assistant.onSoft} />
            <Text style={layout.discussText}>{t('suggestionDiscuss')}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};
