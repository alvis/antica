import { useRouter } from 'expo-router';

import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CitationFootnote, theme } from '@antica/ui';

import { useLocale } from '../../../../providers/LocaleProvider';
import { CitationPanel } from '../../../knowledge/components/CitationPanel';
import { KnowledgePhoto } from '../../../knowledge/components/KnowledgePhoto';
import {
  providerName,
  useKnowledgePreview,
} from '../../../knowledge/hooks/useKnowledgePreview';

import type { FC } from 'react';

import type {
  KnowledgeEvidenceSnapshotV1,
  RecordMessageEntry,
} from '@antica/contracts';

type FrozenEntry = KnowledgeEvidenceSnapshotV1['entries'][number];
type FrozenClaim = FrozenEntry['claims'][number];
type FrozenCitation = FrozenClaim['citations'][number];
type EvidenceReference = NonNullable<
  RecordMessageEntry['answerSegments']
>[number]['evidenceRefs'][number];

/** a footnote of the answer: the frozen source it opens and the claim it supports */
interface Footnote {
  readonly number: number;
  readonly claimKey: string;
  readonly citation: FrozenCitation;
}

const layout = StyleSheet.create({
  text: {
    ...theme.type.chat,
    paddingTop: theme.space[2],
    color: theme.color.text.primary,
  },
  sources: {
    ...theme.font.face('sans', '400'),
    fontSize: 12,
    lineHeight: 18,
    marginTop: theme.space[6],
    color: theme.color.text.tertiary,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: theme.space[12],
    padding: theme.space[10],
    borderRadius: theme.radius.card,
    borderWidth: theme.border.hairline.width,
    borderColor: theme.border.hairline.color,
    backgroundColor: theme.color.bg.surface,
  },
  pressed: { backgroundColor: theme.color.card.pressed },
  photo: { width: 60, height: 60, borderRadius: theme.radius.photo * 0.7 },
  cardText: { flex: 1, minWidth: 0 },
  title: {
    ...theme.font.face('serif', '700'),
    fontSize: 15,
    lineHeight: 20.3,
    color: theme.color.text.primary,
  },
  quote: {
    ...theme.font.face('sans', '400'),
    fontSize: 13.5,
    lineHeight: 20.9,
    marginTop: theme.space[2],
    color: theme.color.text.secondary,
  },
  source: {
    ...theme.font.face('sans', '400'),
    fontSize: 12,
    lineHeight: 18,
    marginTop: theme.space[2],
    color: theme.color.text.tertiary,
  },
});

/**
 * numbers the sources an answer cites in the order the answer first cites them
 * @param message assistant reply with its frozen evidence and answer segments
 * @returns each segment's footnotes and every footnote in order
 */
function answerFootnotes(message: RecordMessageEntry): {
  bySegment: Footnote[][];
  all: Footnote[];
} {
  const snapshot = message.knowledgeEvidence;
  const segments = message.answerSegments ?? [];
  if (!snapshot || Array.isArray(snapshot)) {
    return { bySegment: segments.map(() => []), all: [] };
  }
  const all: Footnote[] = [];
  const find = (
    reference: EvidenceReference,
    citationId: string,
  ): Footnote | undefined => {
    const known = all.find(
      (note) =>
        note.citation.citationId === citationId &&
        note.claimKey === reference.claimKey,
    );
    if (known) {
      return known;
    }
    const citation = snapshot.entries
      .find(
        (entry) =>
          entry.entryId === reference.entryId &&
          entry.revision === reference.revision,
      )
      ?.claims.find((claim) => claim.claimKey === reference.claimKey)
      ?.citations.find((item) => item.citationId === citationId);
    if (!citation) {
      return undefined;
    }
    const note = {
      number: all.length + 1,
      claimKey: reference.claimKey,
      citation,
    };
    all.push(note);

    return note;
  };
  const bySegment = segments.map((segment) =>
    segment.evidenceRefs.flatMap((reference) =>
      reference.citationIds.flatMap((citationId) => {
        const note = find(reference, citationId);

        return note ? [note] : [];
      }),
    ),
  );

  return { bySegment, all };
}

/**
 * Restricts frozen claims to those the answer cites when segments exist.
 * @param entry immutable saved entry
 * @param message the reply whose segments cite it
 * @returns the cited frozen claims, every claim for a reply without segments
 */
function usedClaims(
  entry: FrozenEntry,
  message: RecordMessageEntry,
): FrozenClaim[] {
  const references = message.answerSegments?.flatMap(
    (segment) => segment.evidenceRefs,
  );

  return entry.claims.filter(
    (claim) =>
      !references ||
      references.some(
        (reference) =>
          reference.entryId === entry.entryId &&
          reference.revision === entry.revision &&
          reference.claimKey === claim.claimKey,
      ),
  );
}

/** properties for the assistant's answer text */
export type AnswerTextProps = { message: RecordMessageEntry };

/**
 * the assistant's reply (v5 `.ai .txt`): each sentence followed by numbered footnotes that open the
 * source frozen with the reply, then the 依據 line naming the saved entries it used
 * @param props answer properties
 * @param props.message the assistant reply
 * @returns the answer text
 */
export const AnswerText: FC<AnswerTextProps> = ({ message }) => {
  const { t } = useLocale();
  const [open, setOpen] = useState<FrozenCitation | null>(null);
  const trigger = useRef<View>(null);
  const segments = message.answerSegments ?? [];
  const { bySegment, all } = answerFootnotes(message);
  const snapshot = message.knowledgeEvidence;
  const titles =
    snapshot && !Array.isArray(snapshot)
      ? snapshot.entries
          .filter((entry) => usedClaims(entry, message).length > 0)
          .map((entry) => entry.title)
      : [];

  return (
    <View ref={trigger}>
      <Text style={layout.text}>
        {segments.length === 0
          ? message.body
          : segments.map((segment, index) => (
              <Text key={index}>
                {segment.text}
                {bySegment[index]?.map((note) => (
                  <CitationFootnote
                    key={`${note.claimKey}-${note.citation.citationId}`}
                    inline
                    number={note.number}
                    label={note.citation.sourceTitle}
                    testID={`record-message-knowledge-citation-${message.id}-${note.claimKey}-${note.citation.citationId}`}
                    onPress={() => setOpen(note.citation)}
                  />
                ))}
              </Text>
            ))}
      </Text>
      {all.length > 0 && titles.length > 0 && (
        <Text style={layout.sources}>
          {t('messageSources', { titles: titles.join('、') })}
        </Text>
      )}
      <CitationPanel
        citation={open}
        restoreFocus={trigger.current}
        onClose={() => setOpen(null)}
      />
    </View>
  );
};

/** Historical message and the exact evidence frozen with its answer. */
export type KnowledgeEvidenceCardProps = { message: RecordMessageEntry };

/**
 * the knowledge an answer cites (v5 `.rich.cite`): one card per saved entry with its photo, title,
 * the cited claim and its museum, opening the entry at the revision frozen with the reply
 * @param props historical assistant message
 * @param props.message snapshot and answer references persisted with the reply
 * @returns the cards, or nothing when the reply cites no saved entry
 */
export const KnowledgeEvidenceCard: FC<KnowledgeEvidenceCardProps> = ({
  message,
}) => {
  const snapshot = message.knowledgeEvidence;
  if (!snapshot || Array.isArray(snapshot)) {
    return null;
  }

  return (
    <>
      {snapshot.entries.map((entry) => {
        const claims = usedClaims(entry, message);

        return claims.length > 0 ? (
          <EntryCard
            key={`${entry.entryId}-${entry.revision}`}
            entry={entry}
            claim={claims[0]}
            messageId={message.id}
          />
        ) : null;
      })}
    </>
  );
};

/**
 * one cited entry: its photo, title, the quoted claim and the museum
 * @param props frozen entry and the claim the card quotes
 * @param props.entry saved entry snapshot
 * @param props.claim the cited claim the card quotes
 * @param props.messageId message identity
 * @returns the pressable card
 */
const EntryCard: FC<{
  entry: FrozenEntry;
  claim: FrozenClaim | undefined;
  messageId: string;
}> = ({ entry, claim, messageId }) => {
  const router = useRouter();
  const { t } = useLocale();
  const preview = useKnowledgePreview(entry.entryId, entry.revision);
  const provider = claim?.citations.at(0)?.provider;
  const museum = provider ? providerName(provider, t) : undefined;

  return (
    <Pressable
      testID={`record-message-knowledge-open-${messageId}-${entry.entryId}`}
      accessibilityRole="button"
      accessibilityLabel={t('knowledgeOpenPinnedEntry', {
        title: entry.title,
        revision: entry.revision,
      })}
      onPress={() =>
        router.push(
          `/knowledge/${entry.entryId}?view=revision&revision=${entry.revision}`,
        )
      }
      style={({ pressed }) => [layout.card, pressed && layout.pressed]}>
      <KnowledgePhoto
        image={preview.image}
        accessibilityLabel={entry.title}
        style={layout.photo}
      />
      <View style={layout.cardText}>
        <Text style={layout.title}>{entry.title}</Text>
        {claim && (
          <Text
            testID={`record-message-knowledge-${messageId}-${claim.claimId}`}
            numberOfLines={3}
            style={layout.quote}>
            「{claim.statement}」
          </Text>
        )}
        {museum && (
          <Text style={layout.source}>
            {t('messageCitedSource', { museum })}
          </Text>
        )}
      </View>
    </Pressable>
  );
};
