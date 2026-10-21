import { isDeepStrictEqual } from 'node:util';

import { validateKnowledgeAnswerSegments } from '@antica/application/server';

import {
  editDraftGenerationSchema,
  knowledgeNoSupportedAnswer,
  recordMessageReplyMaxLength,
} from '@antica/contracts';

import type {
  ProposedChange,
  EditDraftResult,
  KnowledgeEvidenceSnapshotV1,
} from '@antica/contracts';

import type { EditingCase, EditingRecord } from './editing-dataset.js';

/** records mechanical verdicts for one reply and its proposals; null when the output is not a valid draft */
export interface EditingChecks {
  readonly schemaValid: boolean;
  readonly identityPreserved: boolean | null;
  readonly replyNonEmpty: boolean | null;
  readonly replyWithinLimit: boolean | null;
  readonly expectedFieldsPresent: boolean | null;
  readonly noUnexpectedFields: boolean | null;
  readonly beforeMatchesRecord: boolean | null;
  readonly noAppliedClaim: boolean | null;
  readonly replyMentionsProposals: boolean | null;
  readonly noEnglishGloss: boolean | null;
  /** null when the case does not ask for a non-allowlisted field */
  readonly refusalStated: boolean | null;
  /** null for legacy cases; reference identity is not entailment */
  readonly evidenceRefsValid: boolean | null;
  readonly expectedEvidencePresent: boolean | null;
  readonly unsupportedAnswer: boolean | null;
  readonly schemaIssues: readonly string[];
}

/** binds one evaluation case to the admitted evidence used by its model call */
export interface EditingCheckContext extends EditingCase {
  readonly knowledgeContext?: KnowledgeEvidenceSnapshotV1;
}

type KnowledgeChecks = Pick<
  EditingChecks,
  'evidenceRefsValid' | 'expectedEvidencePresent' | 'unsupportedAnswer'
>;

const emptyKnowledgeChecks: KnowledgeChecks = {
  evidenceRefsValid: null,
  expectedEvidencePresent: null,
  unsupportedAnswer: null,
};

const pronoun = '(?:幫|為|替|給)(?:你|您)';
const claimVerb =
  '(?:修改|更改|更新|套用|變更|調整|儲存|寫入|刪除|移除|清空|替換|新增|加入|完成|改為|改成|改好|設為|設定|記錄(?!的))';
const fieldLabel =
  '(?:名稱|名字|品名|描述|說明|年代|時代|年份|材質|標籤|判斷|看法)';
const delimiter = '[^，。！？；\\n]';

/** detects replies that claim a proposal already took effect, including claims without 已 */
export const appliedClaimPatterns: readonly RegExp[] = [
  new RegExp(`已(?:經)?(?:${pronoun})?(?:成功)?${claimVerb}`, 'u'),
  new RegExp(
    `已(?:經)?(?:${pronoun})?[將把]${delimiter}{0,20}(?:改|更新|設|寫入|清空|刪除|移除|替換|調整|新增|加入)`,
    'u',
  ),
  new RegExp(
    `[將把]${delimiter}{0,20}(?:改|更新|設|調整|新增|加入|移除|刪除|清空|替換)(?:成|為|好|掉|定)?了`,
    'u',
  ),
  /(?:改|更新|修改|套用|寫入|變更|調整)(?:好了|好囉|好啦|完成|成功)/u,
  new RegExp(
    `${fieldLabel}(?:已經|已)?現在(?:已經|已)?(?:是|為|變成|改成)`,
    'u',
  ),
];

/** lists words that state a field cannot be changed through messages */
export const refusalKeywords: readonly string[] = [
  '無法',
  '不能',
  '不可',
  '沒辦法',
  '不支援',
  '不允許',
  '不提供',
];

/** lists Traditional Chinese labels a reply may use to name a proposed field */
export const fieldLabels: Readonly<
  Record<ProposedChange['field'], readonly string[]>
> = {
  name: ['名稱', '名字', '品名'],
  description: ['描述', '說明'],
  materialIds: ['材質', '材料'],
  categoryIds: ['器類', '分類'],
  surface: ['表面'],
  period: ['年代', '時代', '年份', '朝代'],
  tags: ['標籤'],
  collectorJudgment: ['判斷', '看法', '意見'],
  condition: ['品相', '狀況', '保存狀況'],
  dimensions: ['尺寸', '大小', '口徑', '高度', '座高'],
};

const latinRun = /[A-Za-z]{2,}/u;

/** pairs quotation delimiters whose enclosed text is quoted, not claimed */
const quotationPairs: ReadonlyArray<readonly [string, string]> = [
  ['「', '」'],
  ['『', '』'],
  ['“', '”'],
  ['"', '"'],
];

/**
 * applies the editing contract and case expectations to potentially invalid output
 * @param output provider output or retained invalid output
 * @param record frozen record the proposals must preserve
 * @param item collector message, proposal expectations and admitted frozen knowledge
 * @returns mechanical verdicts for the reply and proposals
 */
export function checkEditingOutput(
  output: unknown,
  record: EditingRecord,
  item: EditingCheckContext,
): EditingChecks {
  const parsed = editDraftGenerationSchema.safeParse(output);
  if (!parsed.success) {
    return {
      schemaValid: false,
      identityPreserved: null,
      replyNonEmpty: null,
      replyWithinLimit: null,
      expectedFieldsPresent: null,
      noUnexpectedFields: null,
      beforeMatchesRecord: null,
      noAppliedClaim: null,
      replyMentionsProposals: null,
      noEnglishGloss: null,
      refusalStated: null,
      ...emptyKnowledgeChecks,
      schemaIssues: parsed.error.issues.map(
        (issue) => `${issue.path.join('.')}: ${issue.message}`,
      ),
    };
  }
  const draft = parsed.data;
  const fields = draft.proposedChanges.map((change) => change.field);
  const allowed = new Set([...item.expectedFields, ...item.permittedFields]);
  const reply = draft.replyZhHant;
  const values = [
    ...Object.values(record.fields),
    ...draft.proposedChanges.map((change) => change.proposed),
  ].flatMap(valueTexts);

  return {
    schemaValid: true,
    ...checkKnowledgeEvidence(draft, item),
    identityPreserved:
      draft.editDraftId === item.requestKey &&
      draft.recordId === record.recordId &&
      isDeepStrictEqual(draft.baseVersions, record.versions) &&
      draft.sourceObservationIds.length === 0 &&
      draft.sourceTranscriptionIds.length === 0,
    replyNonEmpty: reply.trim() !== '',
    replyWithinLimit: reply.length <= recordMessageReplyMaxLength,
    expectedFieldsPresent: item.expectedFields.every((field) =>
      fields.includes(field),
    ),
    noUnexpectedFields:
      new Set(fields).size === fields.length &&
      fields.every((field) => allowed.has(field)),
    beforeMatchesRecord: draft.proposedChanges.every((change) =>
      isDeepStrictEqual(change.before, record.fields[change.field]),
    ),
    replyMentionsProposals: fields.every((field) =>
      fieldLabels[field].some((label) => reply.includes(label)),
    ),
    ...checkReplyWording(reply, values, item),
    schemaIssues: [],
  };
}

/**
 * scores reference identity and explicit abstention without judging entailment
 * @param draft validated model output
 * @param item case expectations and admitted snapshot
 * @returns mechanical knowledge checks, null for legacy cases
 */
function checkKnowledgeEvidence(
  draft: EditDraftResult,
  item: EditingCheckContext,
): KnowledgeChecks {
  const segments = draft.answerSegments ?? [];
  const knowledgeContext = item.knowledgeContext;

  return {
    evidenceRefsValid:
      knowledgeContext === undefined
        ? null
        : segments.length > 0 &&
          validateKnowledgeAnswerSegments(segments, knowledgeContext),
    expectedEvidencePresent:
      item.knowledge === undefined
        ? null
        : item.knowledge.expectedRefs.every((ref) =>
            segments.some((segment) =>
              segment.evidenceRefs.some((actual) =>
                isDeepStrictEqual(actual, ref),
              ),
            ),
          ),
    unsupportedAnswer:
      knowledgeContext?.entries.length !== 0
        ? null
        : isDeepStrictEqual(segments, [
            { text: knowledgeNoSupportedAnswer, evidenceRefs: [] },
          ]) && draft.replyZhHant === knowledgeNoSupportedAnswer,
  };
}

/**
 * checks that a reply claims nothing, adds no English gloss, and refuses restricted fields
 * @param reply assistant reply shown to the collector
 * @param values record and proposed values the reply may repeat verbatim
 * @param item collector message and its behaviour kind
 * @returns wording verdicts for the reply
 */
function checkReplyWording(
  reply: string,
  values: readonly string[],
  item: EditingCase,
): Pick<EditingChecks, 'noAppliedClaim' | 'noEnglishGloss' | 'refusalStated'> {
  return {
    noAppliedClaim:
      reply === knowledgeNoSupportedAnswer || !claimsApplied(reply, values),
    noEnglishGloss: !latinRun.test(
      values.reduce((text, value) => text.replaceAll(value, ''), reply),
    ),
    refusalStated:
      item.kind === 'restricted'
        ? refusalKeywords.some((keyword) => reply.includes(keyword))
        : null,
  };
}

/**
 * detects a reply that says a change already took effect
 * @param reply assistant reply shown to the collector
 * @param values record and proposed values a reply may quote without making a claim
 * @returns whether an applied-claim phrase occurs outside quoted record or proposed values
 */
export function claimsApplied(
  reply: string,
  values: readonly string[] = [],
): boolean {
  const exempt = new Set(values.map((value) => value.trim()));
  let unquoted = reply;
  for (const [open, close] of quotationPairs) {
    unquoted = stripQuoted(unquoted, [open, close], exempt);
  }

  return appliedClaimPatterns.some((pattern) => pattern.test(unquoted));
}

/**
 * flattens a field value into the texts a reply may quote
 * @param value record or proposed field value
 * @returns non-empty text forms of the value
 */
function valueTexts(value: unknown): string[] {
  if (typeof value === 'string') {
    return value.trim() === '' ? [] : [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(valueTexts);
  }
  if (value !== null && typeof value === 'object') {
    return Object.values(value).flatMap(valueTexts);
  }

  return [];
}

/**
 * empties quotations whose text equals an exempt value, without regular-expression backtracking
 * @param text reply text
 * @param pair opening and closing delimiters
 * @param exempt record and proposed values that may be quoted
 * @returns text with each exempt closed quotation emptied
 */
function stripQuoted(
  text: string,
  pair: readonly [string, string],
  exempt: ReadonlySet<string>,
): string {
  const [open, close] = pair;
  let result = '';
  let cursor = 0;
  for (;;) {
    const start = text.indexOf(open, cursor);
    const end = start < 0 ? -1 : text.indexOf(close, start + open.length);
    if (end < 0) {
      return result + text.slice(cursor);
    }
    const quoted = text.slice(start + open.length, end);
    result += exempt.has(quoted.trim())
      ? `${text.slice(cursor, start)}${open}${close}`
      : text.slice(cursor, end + close.length);
    cursor = end + close.length;
  }
}
