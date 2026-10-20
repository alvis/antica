import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  AssistantSeal,
  CitationFootnote,
  styles,
  theme,
} from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import type { UseQueryResult } from '@tanstack/react-query';

import type { FC, ReactNode } from 'react';

import type { KnowledgeSearchPage } from '@antica/contracts';

/** properties for one answered suggested question */
export type AskAnswerProps = {
  question: string;
} & (
  | { kind: 'help'; answer: string }
  | {
      kind: 'search';
      search: Pick<
        UseQueryResult<KnowledgeSearchPage>,
        'data' | 'isPending' | 'error' | 'refetch'
      >;
      /** opens a cited entry */
      onOpenEntry: (entryId: string) => void;
    }
);

const layout = StyleSheet.create({
  mine: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: theme.color.chat.bubble,
    borderRadius: theme.radius.card,
    paddingHorizontal: theme.space[14],
    paddingVertical: theme.space[10],
  },
  mineText: { ...theme.type.body, color: theme.color.chat.onBubble },
  reply: { flexDirection: 'row', gap: theme.space[10] },
  replyBody: { flex: 1, gap: theme.space[8] },
  replyText: { ...theme.type.chat, color: theme.color.text.primary },
  claim: { flexDirection: 'row', alignItems: 'flex-start' },
  claimBody: { flex: 1, paddingTop: theme.space[12] },
  claimText: { ...theme.type.chat, color: theme.color.text.primary },
  tag: { ...theme.type.small, color: theme.color.text.tertiary },
});

/**
 * the assistant's side of the answer, beside its seal
 * @param props reply properties
 * @param props.children reply content
 * @returns the seal and the reply
 */
const Reply: FC<{ children: ReactNode }> = ({ children }) => (
  <View style={layout.reply}>
    <AssistantSeal />
    <View style={layout.replyBody}>{children}</View>
  </View>
);

/**
 * shows the chosen question and its answer: fixed how-to text, or cited excerpts from saved knowledge
 * @param props answer properties
 * @returns the question bubble and the assistant's reply
 */
export const AskAnswer: FC<AskAnswerProps> = (props) => {
  const { t } = useLocale();

  return (
    <View testID="ask-answer" style={{ gap: theme.space.stack }}>
      <View style={layout.mine}>
        <Text style={layout.mineText}>{props.question}</Text>
      </View>
      <Reply>
        {props.kind === 'help' ? (
          <>
            <Text style={layout.replyText}>{props.answer}</Text>
            <Text style={layout.tag}>{t('askHelpTag')}</Text>
          </>
        ) : (
          <KnowledgeReply {...props} />
        )}
      </Reply>
    </View>
  );
};

/**
 * quotes the best saved matches, each with a footnote that opens its entry; never fills gaps
 * @param props search answer properties
 * @param props.search the knowledge search for the question
 * @param props.onOpenEntry opens a cited entry
 * @returns the cited reply, its progress or its failure
 */
const KnowledgeReply: FC<Extract<AskAnswerProps, { kind: 'search' }>> = ({
  search,
  onOpenEntry,
}) => {
  const { locale, t } = useLocale();
  if (search.isPending) {
    return (
      <View style={styles.row}>
        <ActivityIndicator color={theme.color.accent.default} />
        <Text style={styles.secondary}>{t('askSearching')}</Text>
      </View>
    );
  }
  if (search.error || !search.data) {
    return (
      <>
        <Text accessibilityRole="alert" style={styles.error}>
          {t('askSearchFailed')}
        </Text>
        <ActionButton
          secondary
          label={t('retry')}
          onPress={() => void search.refetch()}
        />
      </>
    );
  }
  const cited = search.data.hits.filter((hit) => hit.excerpt !== null);
  if (cited.length === 0) {
    return <Text style={layout.replyText}>{t('askNoSources')}</Text>;
  }
  const sources = [...new Set(cited.flatMap((hit) => hit.providers))];

  return (
    <>
      {cited.map((hit, index) => (
        <View key={hit.id} testID={`ask-claim-${hit.id}`} style={layout.claim}>
          <View style={layout.claimBody}>
            <Text style={layout.claimText}>{hit.excerpt?.text}</Text>
            {hit.excerpt && hit.excerpt.language !== locale && (
              <Text style={layout.tag}>
                {t('knowledgeLanguageFallback', {
                  language: hit.excerpt.language,
                })}
              </Text>
            )}
          </View>
          <CitationFootnote
            number={index + 1}
            label={hit.title}
            testID={`ask-cite-${hit.id}`}
            onPress={() => onOpenEntry(hit.id)}
          />
        </View>
      ))}
      <Text style={layout.tag}>
        {t('askSourcesLine', {
          sources: sources.length > 0 ? sources.join(' · ') : cited[0].title,
        })}
      </Text>
    </>
  );
};
