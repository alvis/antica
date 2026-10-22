import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AssistantSeal, theme } from '@antica/ui';

import { RecordPhoto } from '../../../../components/RecordPhoto';
import { useLocale } from '../../../../providers/LocaleProvider';

import { ExampleChip } from '../../../analysis/components/ExampleChip';
import { SuggestionConfidence } from '../../../analysis/components/SuggestionConfidence';

import type { ProposalConfidence } from '../../../analysis/components/SuggestionConfidence';
import { angleLabel } from '../../record-hub';

import type { FC } from 'react';

import type { CitedEntry } from '../../../analysis/hooks/useCitedEntries';
import type { SuggestionPhoto } from '../../../analysis/suggestions';

/** properties for the suggestion attached to the conversation */
export type DiscussCardProps = {
  /** the suggestion's field, such as 年代 */
  field: string;
  /** the suggested value */
  value: string;
  confidence?: ProposalConfidence;
  photos: readonly SuggestionPhoto[];
  example?: CitedEntry;
  onOpenPhoto: (assetId: string, anchorId: string) => void;
  onOpenExample: (example: CitedEntry) => void;
};

const layout = StyleSheet.create({
  card: {
    alignSelf: 'flex-end',
    width: '92%',
    paddingVertical: theme.space[12],
    paddingHorizontal: 14,
    borderRadius: theme.radius.card,
    borderWidth: theme.border.control.width,
    borderColor: theme.border.control.color,
    backgroundColor: theme.color.bg.surface,
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.space[6],
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: theme.space[6] },
  topText: {
    ...theme.font.face('sans', '700'),
    fontSize: 12,
    lineHeight: 16.8,
    color: theme.color.assistant.onSoft,
  },
  value: {
    ...theme.font.face('serif', '700'),
    fontSize: 17,
    lineHeight: 23.8,
    marginTop: theme.space[4],
    color: theme.color.text.primary,
  },
  evidence: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.space[8],
    marginTop: theme.space[8],
  },
  photo: { width: 56, alignItems: 'center' },
  photoFrame: { width: 56, height: 56, borderRadius: theme.radius.photo * 0.7 },
  photoLabel: {
    marginTop: theme.space[4],
    ...theme.font.face('sans', '400'),
    fontSize: 12,
    lineHeight: 15.6,
    color: theme.color.text.tertiary,
  },
});

/**
 * the suggestion 討論這項 attached (v5 `.attached`): its field, value and evidence, waiting for the
 * collector's first question
 * @param props card properties
 * @param props.field the suggestion's field
 * @param props.value the suggested value
 * @param props.confidence the proposal's reported confidence
 * @param props.photos photos the suggestion rests on
 * @param props.example the museum example behind it
 * @param props.onOpenPhoto opens an evidence photo
 * @param props.onOpenExample opens the museum example
 * @returns the card
 */
export const DiscussCard: FC<DiscussCardProps> = ({
  field,
  value,
  confidence,
  photos,
  example,
  onOpenPhoto,
  onOpenExample,
}) => {
  const { t } = useLocale();

  return (
    <View testID="record-message-discuss-card" style={layout.card}>
      <View style={layout.top}>
        <View style={layout.heading}>
          <AssistantSeal size="mini" />
          <Text style={layout.topText}>{t('discussHeading', { field })}</Text>
        </View>
        <SuggestionConfidence confidence={confidence} />
      </View>
      <Text style={layout.value}>{value}</Text>
      {(photos.length > 0 || example) && (
        <View style={layout.evidence}>
          {photos.map((photo) => {
            const angle = angleLabel(photo.fileName);

            return (
              <Pressable
                key={photo.assetId}
                accessibilityRole="button"
                accessibilityLabel={t('suggestionEvidencePhoto', {
                  angle: angle ?? photo.fileName,
                })}
                onPress={() => onOpenPhoto(photo.assetId, photo.anchorId)}
                style={layout.photo}>
                <RecordPhoto uri={photo.uri} style={layout.photoFrame} />
                {angle && <Text style={layout.photoLabel}>{angle}</Text>}
              </Pressable>
            );
          })}
          {example && (
            <ExampleChip
              testID="record-message-discuss-example"
              example={example}
              onOpen={onOpenExample}
            />
          )}
        </View>
      )}
    </View>
  );
};
