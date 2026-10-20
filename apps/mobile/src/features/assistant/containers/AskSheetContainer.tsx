import { useRouter } from 'expo-router';

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AssistantSeal, BottomSheet, Card, styles, theme } from '@antica/ui';

import { useAskAssistant } from '../../../providers/AskAssistantProvider';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import {
  signInHelpQuestions,
  summarizeAskContext,
  suggestAskQuestions,
} from '../ask-context';
import { AskAnswer } from '../components/AskAnswer';
import { useAskKnowledgeAnswer } from '../hooks/useAskKnowledgeAnswer';

import type { FC } from 'react';

import type { AskContext, AskQuestion } from '../ask-context';

const layout = StyleSheet.create({
  kicker: { ...theme.type.label, color: theme.color.assistant.onSoft },
  name: { ...theme.type.heading, color: theme.color.text.primary },
  intro: { flexDirection: 'row', gap: theme.space[10] },
  introText: { ...theme.type.chat, flex: 1, color: theme.color.text.primary },
  question: {
    minHeight: theme.size.rowMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.space[8],
    backgroundColor: theme.color.bg.surface,
    borderRadius: theme.radius.field,
    borderWidth: theme.border.control.width,
    borderColor: theme.border.control.color,
    paddingHorizontal: theme.space[16],
    paddingVertical: theme.space[12],
  },
  questionText: {
    ...theme.type.body,
    flex: 1,
    color: theme.color.text.primary,
  },
  chevron: { fontSize: 20, color: theme.color.text.tertiary },
});

/**
 * the sheet's first card: what the screen behind it attached
 * @param props card properties
 * @param props.context the attachment
 * @returns the kicker, the attached thing and how it is attached
 */
const AskContextCard: FC<{ context: AskContext }> = ({ context }) => {
  const { t } = useLocale();
  const summary = summarizeAskContext(context, t);

  return (
    <Card testID="ask-context">
      <Text style={layout.kicker}>{summary.kicker}</Text>
      <Text testID="ask-context-name" style={layout.name}>
        {summary.name}
      </Text>
      {summary.detail ? (
        <Text style={styles.secondary}>{summary.detail}</Text>
      ) : null}
    </Card>
  );
};

/**
 * the suggested questions; a record question carries an arrow because it leaves for the conversation
 * @param props list properties
 * @param props.questions questions in display order
 * @param props.chosenId the question whose answer the sheet shows, marked selected
 * @param props.onPick answers or routes a question
 * @returns the label, the question rows and the conversation hint
 */
const AskQuestionList: FC<{
  questions: readonly AskQuestion[];
  chosenId?: string;
  onPick: (question: AskQuestion) => void;
}> = ({ questions, chosenId, onPick }) => {
  const { t } = useLocale();

  return (
    <>
      <Text style={styles.label}>{t('askSuggested')}</Text>
      {questions.map((question) => (
        <Pressable
          key={question.id}
          testID={`ask-question-${question.id}`}
          accessibilityRole="button"
          accessibilityLabel={question.text}
          aria-selected={question.id === chosenId}
          onPress={() => onPick(question)}
          style={layout.question}>
          <Text style={layout.questionText}>{question.text}</Text>
          <Text
            accessibilityElementsHidden
            importantForAccessibility="no"
            style={layout.chevron}>
            {question.kind === 'message' ? '→' : '›'}
          </Text>
        </Pressable>
      ))}
      {questions.some((question) => question.kind === 'message') && (
        <Text style={styles.secondary}>{t('askMessageHint')}</Text>
      )}
    </>
  );
};

/**
 * answers the chosen question in the sheet: how-to text, or a cited knowledge search
 * @param props answer properties
 * @param props.question the chosen question; conversation drafts never reach here
 * @param props.onOpenEntry opens a cited entry
 * @returns the answer, or nothing for a conversation draft
 */
const ChosenAnswer: FC<{
  question: AskQuestion;
  onOpenEntry: (entryId: string) => void;
}> = ({ question, onOpenEntry }) => {
  const search = useAskKnowledgeAnswer(
    question.kind === 'search' ? question.query : null,
  );
  switch (question.kind) {
    case 'help':
      return (
        <AskAnswer
          question={question.text}
          kind="help"
          answer={question.answer}
        />
      );
    case 'search':
      return (
        <AskAnswer
          question={question.text}
          kind="search"
          search={search}
          onOpenEntry={onOpenEntry}
        />
      );
    default:
      return null;
  }
};

/**
 * the ask sheet every screen's pill opens: what is attached, suggested questions and one answer.
 * It only reads; a record question opens the conversation with an unsent draft, so changes
 * still arrive only as edit cards the collector confirms.
 * @returns the sheet, closed while no screen has asked
 */
export const AskSheetContainer: FC = () => {
  const ask = useAskAssistant();
  const router = useRouter();
  const { t } = useLocale();
  const { authenticated } = useAuth();
  const context = ask?.context ?? null;
  const [chosen, setChosen] = useState<AskQuestion | null>(null);
  // each opening starts from the questions, not the last answer
  useEffect(() => setChosen(null), [context]);
  if (!ask) {
    return null;
  }
  const questions = !context
    ? []
    : context.kind === 'none' && !authenticated
      ? signInHelpQuestions(t)
      : suggestAskQuestions(context, t);

  const pick = (question: AskQuestion): void => {
    if (question.kind === 'message') {
      ask.leave();
      router.push(
        `/collection/${encodeURIComponent(question.recordId)}/messages?draft=${encodeURIComponent(question.text)}`,
      );

      return;
    }
    setChosen(question);
  };

  return (
    <BottomSheet
      testID="ask-sheet"
      visible={context !== null}
      title={t('askAssistant')}
      closeLabel={t('askClose')}
      titleAccessory={<AssistantSeal />}
      onClose={ask.close}>
      {context && <AskContextCard context={context} />}
      <View style={layout.intro}>
        <AssistantSeal />
        <Text style={layout.introText}>{t('askIntro')}</Text>
      </View>
      <AskQuestionList
        questions={questions}
        chosenId={chosen?.id}
        onPick={pick}
      />
      {chosen && (
        <ChosenAnswer
          question={chosen}
          onOpenEntry={(entryId) => {
            ask.leave();
            router.push(`/knowledge/${encodeURIComponent(entryId)}`);
          }}
        />
      )}
    </BottomSheet>
  );
};
