import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { claimText } from '../api/knowledge';

import type { FC } from 'react';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

/** statement rendering with revision-pinned evidence controls */
export type CitedClaimProps = {
  claim: KnowledgeContentEnvelopeV2['claims'][number];
  citations: KnowledgeContentEnvelopeV2['citations'];
  original: boolean;
  onCitation: (
    citation: KnowledgeContentEnvelopeV2['citations'][number],
    trigger: View | null,
  ) => void;
};
const layout = StyleSheet.create({
  citation: { minHeight: 48, padding: 12, justifyContent: 'center' },
});

/**
 * renders support, applicability and uncertainty beside each claim
 * @param root0 component properties
 * @param root0.claim claim property
 * @param root0.citations citations property
 * @param root0.original original property
 * @param root0.onCitation onCitation property
 * @returns rendered knowledge content
 */
export const CitedClaim: FC<CitedClaimProps> = ({
  claim,
  citations,
  original,
  onCitation,
}) => {
  const { locale, t } = useLocale();
  const triggers = useRef(new Map<string, View>());
  const display = claimText(claim, locale, original);

  return (
    <View testID={`knowledge-claim-${claim.claimKey}`} style={styles.card}>
      <Text style={styles.body}>{display.text}</Text>
      {display.fallback && (
        <Text style={styles.secondary}>
          {t('knowledgeLanguageFallback', { language: display.language })}
        </Text>
      )}
      <ClaimContext claim={claim} />
      {citations
        .filter((citation) => claim.citationIds.includes(citation.id))
        .map((citation) => (
          <Pressable
            key={citation.id}
            ref={(node) => {
              if (node) {
                triggers.current.set(citation.id, node);
              } else {
                triggers.current.delete(citation.id);
              }
            }}
            accessibilityRole="button"
            style={layout.citation}
            testID={`knowledge-citation-${claim.claimKey}-${citation.id}`}
            onPress={() =>
              onCitation(citation, triggers.current.get(citation.id) ?? null)
            }>
            <Text style={styles.body}>
              {t('knowledgeCitation', {
                number:
                  citations.findIndex((item) => item.id === citation.id) + 1,
              })}
            </Text>
          </Pressable>
        ))}
    </View>
  );
};

/**
 * displays support, review, applicability and uncertainty as text
 * @param props claim provenance and scope
 * @param props.claim source statement with editorial and support metadata
 * @returns localized provenance badges and applicability text
 */
const ClaimContext: FC<Pick<CitedClaimProps, 'claim'>> = ({ claim }) => {
  const { t } = useLocale();

  return (
    <>
      <Text style={styles.secondary}>
        {t(
          claim.supportState === 'needs_source'
            ? 'knowledgeNeedsSource'
            : 'knowledgeCited',
        )}{' '}
        ·{' '}
        {t(
          claim.review.state === 'reviewed'
            ? 'knowledgeReviewReviewed'
            : claim.review.state === 'rejected'
              ? 'knowledgeReviewRejected'
              : 'knowledgeReviewPending',
        )}
      </Text>
      {claim.review.at && (
        <Text style={styles.secondary}>
          {t('knowledgeReviewedAt', { date: claim.review.at })}
        </Text>
      )}
      {Object.entries(claim.scope).map(([key, values]) => (
        <Text key={key} style={styles.body}>
          {t('scope')}: {key} · {values.join(', ')}
        </Text>
      ))}
      {Object.entries(claim.qualifiers).map(([key, value]) => (
        <Text key={key} style={styles.body}>
          {key}: {value}
        </Text>
      ))}
      {claim.uncertainty && (
        <Text style={styles.body}>
          {t('knowledgeUncertainty')}: {claim.uncertainty}
        </Text>
      )}
    </>
  );
};
