import {
  corpusGuideFieldSchema,
  corpusGuideGroupSchema,
} from '@antica/contracts';

import { unique } from './context.js';
import { validateClaim } from './entries/claims.js';
import { validateGuideStatement } from './guides/statements.js';
import { validateLabels } from './taxonomy.js';

import type { CorpusExaminationGuide } from '@antica/contracts';

import type { CorpusContext, Located } from './context.js';

type GuideCheck = CorpusExaminationGuide['checks'][number];
interface CheckRecord extends Located<GuideCheck> {
  guide: CorpusExaminationGuide;
}

const collectorAuthorization =
  "I've got the authorization already. I'm making app for them. include all information you find.";

/**
 * validates ordered observation guidance and its source-bound evidence
 * @param context indexed corpus and diagnostic collector
 */
export function validateGuides(context: CorpusContext): void {
  for (const record of context.guides.values()) {
    validateGuideReferences(context, record);
    validateGuideChecks(context, record);
  }
}

/**
 * checks localized guide identity and source/topic bindings
 * @param context indexed corpus and diagnostic collector
 * @param record guide and its owning file
 */
function validateGuideReferences(
  context: CorpusContext,
  record: Located<CorpusExaminationGuide>,
): void {
  const guide = record.value;
  validateLabels(context, guide.titles, { ...record, path: '$.titles' });
  unique(context, guide.appliesToTopicIds, {
    ...record,
    path: '$.appliesToTopicIds',
  });
  guide.appliesToTopicIds.forEach((id, index) =>
    context.check(
      context.topics.has(id),
      { ...record, path: `$.appliesToTopicIds[${index}]` },
      { code: 'guide_topic', message: 'Guide topic must exist' },
    ),
  );
  unique(context, guide.externalObjectIds, {
    ...record,
    path: '$.externalObjectIds',
  });
  guide.externalObjectIds.forEach((id, index) => {
    const source = context.sources.get(id);
    context.check(
      source !== undefined,
      { ...record, path: `$.externalObjectIds[${index}]` },
      { code: 'guide_source', message: 'Guide source must exist' },
    );
    if (source !== undefined) {
      context.check(
        source.value.licenceBasis !== undefined,
        { ...source, path: '$.licenceBasis' },
        {
          code: 'guide_licence',
          message: 'Guide sources require an explicit licence basis',
        },
      );
      context.check(
        Boolean(
          source.value.authorizationNote?.includes('2026-10-20') &&
          source.value.authorizationNote.includes(collectorAuthorization),
        ),
        { ...source, path: '$.authorizationNote' },
        {
          code: 'guide_authorization',
          message:
            'Guide sources must retain the dated collector authorization statement',
        },
      );
    }
  });
}

/**
 * validates stable local identities, group order and field coverage
 * @param context indexed corpus and diagnostic collector
 * @param record guide and its owning file
 */
function validateGuideChecks(
  context: CorpusContext,
  record: Located<CorpusExaminationGuide>,
): void {
  const guide = record.value;
  const location = { ...record, path: '$.checks' };
  unique(
    context,
    guide.checks.map((check) => check.checkKey),
    location,
  );
  unique(
    context,
    guide.checks.map((check) => `${check.group}:${check.ordinal}`),
    location,
  );
  unique(
    context,
    guide.checks.flatMap((check) =>
      check.statements.map((statement) => statement.claimKey),
    ),
    location,
  );
  guide.checks.forEach((check, index) => {
    const checkRecord = {
      ...record,
      value: check,
      guide,
      path: `$.checks[${index}]`,
    };
    const previous = guide.checks[index - 1];
    context.check(
      previous === undefined ||
        corpusGuideGroupSchema.options.indexOf(previous.group) <
          corpusGuideGroupSchema.options.indexOf(check.group) ||
        (previous.group === check.group && previous.ordinal < check.ordinal),
      checkRecord,
      {
        code: 'guide_order',
        message:
          'Checks must follow observation group order and increasing ordinals',
      },
    );
    validateCheck(context, checkRecord);
  });
}

/**
 * checks photographs and related knowledge bindings without assigning a judgment
 * @param context indexed corpus and diagnostic collector
 * @param record check and its enclosing guide
 */
function validateCheckReferences(
  context: CorpusContext,
  record: CheckRecord,
): void {
  const check = record.value;
  unique(context, check.relatedEntryIds, {
    ...record,
    path: `${record.path}.relatedEntryIds`,
  });
  check.relatedEntryIds.forEach((id, index) =>
    context.check(
      context.entries.has(id),
      { ...record, path: `${record.path}.relatedEntryIds[${index}]` },
      { code: 'guide_entry', message: 'Related knowledge entry must exist' },
    ),
  );
  unique(context, check.imageIds, {
    ...record,
    path: `${record.path}.imageIds`,
  });
  check.imageIds.forEach((id, index) => {
    const image = context.images.get(id);
    const location = { ...record, path: `${record.path}.imageIds[${index}]` };
    context.check(
      image !== undefined &&
        record.guide.externalObjectIds.includes(image.source.id),
      location,
      {
        code: 'guide_image',
        message: 'Guide image must belong to a bound source',
      },
    );
    if (image !== undefined) {
      context.check(
        image.value.showable === true && image.value.role !== undefined,
        location,
        {
          code: 'guide_image_display',
          message:
            'Guide images require explicit showability and a typical or warning role',
        },
      );
    }
  });
}

/**
 * validates field coverage and atomic evidence within an ordered check
 * @param context indexed corpus and diagnostic collector
 * @param checkRecord check and its enclosing guide
 */
function validateCheck(context: CorpusContext, checkRecord: CheckRecord): void {
  const { value: check, guide } = checkRecord;
  validateLabels(context, check.labels, {
    ...checkRecord,
    path: `${checkRecord.path}.labels`,
  });
  validateCheckReferences(context, checkRecord);
  unique(
    context,
    check.statements.map(
      (statement) => `${statement.field}:${statement.ordinal}`,
    ),
    checkRecord,
  );
  unique(context, check.gap?.fields ?? [], {
    ...checkRecord,
    path: `${checkRecord.path}.gap.fields`,
  });
  for (const field of corpusGuideFieldSchema.options) {
    const statements = check.statements.filter(
      (statement) => statement.field === field,
    );
    context.check(
      (statements.length > 0 &&
        statements.every((statement) => statement.supportState === 'cited')) ||
        check.gap?.fields.includes(field) === true,
      { ...checkRecord, path: `${checkRecord.path}.gap` },
      {
        code: 'guide_gap',
        message: `Missing or unsupported ${field} statements require a declared source gap`,
      },
    );
  }
  check.statements.forEach((statement, ordinal) => {
    const statementRecord = {
      ...checkRecord,
      value: statement,
      path: `${checkRecord.path}.statements[${ordinal}]`,
    };
    validateClaim(context, {
      ...statementRecord,
      entry: guide,
      providers: new Set<string>(),
    });
    validateGuideStatement(context, statementRecord);
  });
}
