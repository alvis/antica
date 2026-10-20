import type { LocaleState } from '../../providers/LocaleProvider';

/** what the screen behind the ask sheet attaches to a question */
export type AskContext =
  | { readonly kind: 'none' }
  | {
      readonly kind: 'record';
      readonly recordId: string;
      /** the record's display name, when the screen has loaded it */
      readonly name?: string;
      /** the record's catalogue code, shown as its id when loaded */
      readonly code?: string;
    }
  | {
      readonly kind: 'suggestion';
      readonly recordId: string;
      /** localized name of the field the suggestion changes */
      readonly field: string;
      /** the findings the suggestion rests on */
      readonly evidence: readonly string[];
    }
  | {
      readonly kind: 'knowledge';
      readonly entryId: string;
      /** the entry's title in the interface language */
      readonly title: string;
    }
  | {
      readonly kind: 'capture';
      /** the check or step the camera is on now */
      readonly check: string;
    };

/** what a suggested question does when the collector picks it */
export type AskQuestion = {
  /** stable key for the question's automation identifier */
  readonly id: string;
  readonly text: string;
} & (
  | {
      /** opens the record's conversation with the question as an unsent draft */
      readonly kind: 'message';
      readonly recordId: string;
    }
  | {
      /** answers from the saved knowledge base, citing what it finds */
      readonly kind: 'search';
      readonly query: string;
    }
  | {
      /** answers with fixed how-to text that makes no knowledge claim */
      readonly kind: 'help';
      readonly answer: string;
    }
);

/** the first card of the ask sheet: what is attached */
export interface AskContextSummary {
  readonly kicker: string;
  readonly name: string;
  readonly detail: string;
}

type Translate = LocaleState['t'];

/** the shortest record or entry id prefix that still reads as an identifier */
const shownIdLength = 8;

/**
 * shortens an opaque id for display; the full id stays attached
 * @param id record or entry identifier
 * @returns the leading characters of the id
 */
function shortId(id: string): string {
  return id.slice(0, shownIdLength);
}

/**
 * states what the ask sheet attaches from the screen behind it
 * @param context the screen's attachment
 * @param t translator for the interface language
 * @returns the kicker, name and detail lines of the context card
 */
export function summarizeAskContext(
  context: AskContext,
  t: Translate,
): AskContextSummary {
  switch (context.kind) {
    case 'record':
      return {
        kicker: t('askAboutRecord'),
        name: context.name ?? context.code ?? shortId(context.recordId),
        detail: t('askAttachedRecord', {
          id: context.code ?? shortId(context.recordId),
        }),
      };
    case 'suggestion':
      return {
        kicker: t('askAboutSuggestion'),
        name: context.field,
        detail: t('askAttachedSuggestion', {
          field: context.field,
          count: context.evidence.length,
        }),
      };
    case 'knowledge':
      return {
        kicker: t('askAboutEntry'),
        name: context.title,
        detail: t('askAttachedEntry', { id: shortId(context.entryId) }),
      };
    case 'capture':
      return {
        kicker: t('askAboutCapture'),
        name: context.check,
        detail: t('askAttachedCapture', { check: context.check }),
      };
    default:
      return {
        kicker: t('askAboutScreen'),
        name: t('askAttachedNone'),
        detail: '',
      };
  }
}

/**
 * a question the assistant answers only by saying it does not write
 * @param id stable key of the question
 * @param text the question
 * @param t translator for the answer
 * @returns the help question
 */
function neverWrites(id: string, text: string, t: Translate): AskQuestion {
  return { id, text, kind: 'help', answer: t('askNeverWrites') };
}

/**
 * questions about one record, sent to its conversation as unsent drafts
 * @param recordId the attached record
 * @param t translator for the questions
 * @returns two conversation drafts and the never-writes answer
 */
function recordQuestions(recordId: string, t: Translate): AskQuestion[] {
  return [
    { id: 'similar', text: t('askRecordSimilar'), kind: 'message', recordId },
    {
      id: 'missing-photos',
      text: t('askRecordMissingPhotos'),
      kind: 'message',
      recordId,
    },
    neverWrites('write', t('askRecordWrite'), t),
  ];
}

/**
 * questions about one suggestion, sent to its record's conversation
 * @param context the attached suggestion
 * @param context.recordId record the suggestion belongs to
 * @param context.field localized field the suggestion changes
 * @param t translator for the questions
 * @returns two conversation drafts and the never-writes answer
 */
function suggestionQuestions(
  { recordId, field }: { recordId: string; field: string },
  t: Translate,
): AskQuestion[] {
  return [
    {
      id: 'why',
      text: t('askSuggestionWhy', { field }),
      kind: 'message',
      recordId,
    },
    {
      id: 'evidence',
      text: t('askSuggestionEvidence'),
      kind: 'message',
      recordId,
    },
    neverWrites('apply', t('askSuggestionApply'), t),
  ];
}

/**
 * questions about the capture checklist: one searched in the corpus, two how-to answers
 * @param t translator for the questions
 * @returns the checklist's questions in display order
 */
function captureQuestions(t: Translate): AskQuestion[] {
  return [
    {
      id: 'base',
      text: t('askCaptureBase'),
      kind: 'search',
      query: t('askCaptureBaseQuery'),
    },
    {
      id: 'scale',
      text: t('askCaptureScale'),
      kind: 'help',
      answer: t('askCaptureScaleAnswer'),
    },
    {
      id: 'video',
      text: t('askCaptureVideo'),
      kind: 'help',
      answer: t('askCaptureVideoAnswer'),
    },
  ];
}

/**
 * questions with nothing attached once signed in: two knowledge searches and the never-writes answer
 * @param t translator for the questions
 * @returns the general questions in display order
 */
function generalQuestions(t: Translate): AskQuestion[] {
  return [
    {
      id: 'ru',
      text: t('askGeneralRu'),
      kind: 'search',
      query: t('askGeneralRuQuery'),
    },
    {
      id: 'huanghuali',
      text: t('askGeneralHuanghuali'),
      kind: 'search',
      query: t('askGeneralHuanghualiQuery'),
    },
    neverWrites('writes', t('askGeneralWrites'), t),
  ];
}

/**
 * how-to questions before sign-in, when the knowledge base cannot be searched yet
 * @param t translator for the questions
 * @returns the sign-in help questions in display order
 */
export function signInHelpQuestions(t: Translate): readonly AskQuestion[] {
  return [
    {
      id: 'code',
      text: t('askLoginCode'),
      kind: 'help',
      answer: t('askLoginCodeAnswer'),
    },
    {
      id: 'approved',
      text: t('askLoginApproved'),
      kind: 'help',
      answer: t('askLoginApprovedAnswer'),
    },
  ];
}

/**
 * writes two or three questions for the attached context; none of them changes a record
 * @param context the screen's attachment
 * @param t translator for the interface language
 * @returns the suggested questions in display order
 */
export function suggestAskQuestions(
  context: AskContext,
  t: Translate,
): readonly AskQuestion[] {
  switch (context.kind) {
    case 'record':
      return recordQuestions(context.recordId, t);
    case 'suggestion':
      return suggestionQuestions(context, t);
    case 'knowledge':
      return [
        {
          id: 'related',
          text: t('askEntryRelated'),
          kind: 'search',
          query: context.title,
        },
        {
          id: 'authenticate',
          text: t('askEntryAuthenticate'),
          kind: 'help',
          answer: t('askEntryAuthenticateAnswer'),
        },
      ];
    case 'capture':
      return captureQuestions(t);
    default:
      return generalQuestions(t);
  }
}
