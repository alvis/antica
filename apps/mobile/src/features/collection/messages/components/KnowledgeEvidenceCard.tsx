import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../../providers/LocaleProvider';
import { KnowledgeCitations } from '../../../knowledge/components/KnowledgeCitations';

import type { FC } from 'react';

import type {
  KnowledgeEvidenceSnapshotV1,
  RecordMessageEntry,
} from '@antica/contracts';

/** Historical message and the exact evidence frozen with its answer. */
export type KnowledgeEvidenceCardProps = { message: RecordMessageEntry };

/**
 * Renders answer references from the frozen snapshot without fetching current revisions.
 * @param props historical assistant message
 * @param props.message snapshot and answer references persisted with the reply
 * @returns cited claims actually referenced by the answer, or no evidence section
 */
export const KnowledgeEvidenceCard: FC<KnowledgeEvidenceCardProps> = ({
  message,
}) => {
  const snapshot = message.knowledgeEvidence;
  if (!snapshot || Array.isArray(snapshot)) {
    return null;
  }
  const references = message.answerSegments?.flatMap(
    (segment) => segment.evidenceRefs,
  );

  return (
    <>
      {snapshot.entries.map((entry) => (
        <EntryEvidence
          key={`${entry.entryId}-${entry.revision}`}
          entry={entry}
          messageId={message.id}
          references={references}
        />
      ))}
    </>
  );
};

type FrozenEntry = KnowledgeEvidenceSnapshotV1['entries'][number];
type FrozenClaim = FrozenEntry['claims'][number];
type EvidenceReferences = NonNullable<
  RecordMessageEntry['answerSegments']
>[number]['evidenceRefs'];

/**
 * Restricts frozen claims to citations referenced by the answer when segments exist.
 * @param entry immutable saved entry
 * @param references exact answer references, absent on legacy replies
 * @returns only the cited frozen claims
 */
function usedClaims(
  entry: FrozenEntry,
  references: EvidenceReferences | undefined,
): FrozenClaim[] {
  return entry.claims.flatMap((claim) => {
    const used = references?.filter(
      (reference) =>
        reference.entryId === entry.entryId &&
        reference.revision === entry.revision &&
        reference.claimKey === claim.claimKey,
    );
    const citations = claim.citations.filter(
      (citation) =>
        !used ||
        used.some((reference) =>
          reference.citationIds.includes(citation.citationId),
        ),
    );

    return citations.length ? [{ ...claim, citations }] : [];
  });
}

/**
 * Presents an immutable entry and navigation to its exact saved revision.
 * @param props frozen entry and answer context
 * @param props.entry saved entry snapshot
 * @param props.messageId message identity
 * @param props.references answer's referenced citations
 * @returns evidence with a pinned detail action
 */
const EntryEvidence: FC<{
  entry: FrozenEntry;
  messageId: string;
  references: EvidenceReferences | undefined;
}> = ({ entry, messageId, references }) => {
  const router = useRouter();
  const { t } = useLocale();
  const claims = usedClaims(entry, references);
  if (!claims.length) {
    return null;
  }

  return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.heading}>
        {entry.title}
      </Text>
      <Text style={styles.secondary}>
        {t('knowledgePinnedRevision', { revision: entry.revision })}
      </Text>
      {claims.map((claim) => (
        <ClaimEvidence
          key={claim.claimKey}
          claim={claim}
          messageId={messageId}
        />
      ))}
      <ActionButton
        testID={`record-message-knowledge-open-${messageId}-${entry.entryId}`}
        label={t('knowledgeOpenPinnedEntry', {
          title: entry.title,
          revision: entry.revision,
        })}
        onPress={() =>
          router.push(
            `/knowledge/${entry.entryId}?view=revision&revision=${entry.revision}`,
          )
        }
        secondary
      />
    </View>
  );
};

/**
 * Keeps source controls beside the frozen statement and its limitations.
 * @param props frozen claim and owning message
 * @param props.claim saved statement, scope and citations
 * @param props.messageId message identity
 * @returns historical claim and captured source controls
 */
const ClaimEvidence: FC<{ claim: FrozenClaim; messageId: string }> = ({
  claim,
  messageId,
}) => {
  const { t } = useLocale();

  return (
    <View testID={`record-message-knowledge-${messageId}-${claim.claimId}`}>
      <Text style={styles.body}>{claim.statement}</Text>
      <Text style={styles.secondary}>{claim.originalText}</Text>
      {Object.entries(claim.scope).map(([name, values]) => (
        <Text key={name} style={styles.body}>
          {t('scope')}: {name} · {values.join(', ')}
        </Text>
      ))}
      {Object.entries(claim.qualifiers).map(([name, value]) => (
        <Text key={name} style={styles.body}>
          {name}: {value}
        </Text>
      ))}
      {claim.uncertainty && (
        <Text style={styles.body}>
          {t('knowledgeUncertainty')}: {claim.uncertainty}
        </Text>
      )}
      <KnowledgeCitations
        citations={claim.citations}
        testIDPrefix={`record-message-knowledge-citation-${messageId}-${claim.claimKey}`}
      />
    </View>
  );
};
