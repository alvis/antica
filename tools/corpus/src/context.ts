import type {
  CorpusEntry,
  CorpusExaminationGuide,
  CorpusFile,
  CorpusQueries,
  CorpusRelease,
  CorpusSource,
  CorpusTaxonomy,
} from '@antica/contracts';

import type { CorpusDocument, CorpusIssue } from './validate.js';

/** A typed corpus record with a diagnostic location */
export interface Located<T> {
  file: string;
  path: string;
  value: T;
}
export type Topic = CorpusTaxonomy['topics'][number];
export type Citation = CorpusSource['citations'][number];
export type Locator = CorpusSource['locators'][number];
export type Image = CorpusSource['images'][number];
export interface SourceChild<T> extends Located<T> {
  source: CorpusSource;
}

/** indexed references and the deterministic diagnostic collector */
export class CorpusContext {
  public readonly issues: CorpusIssue[] = [];
  public readonly identities = new Set<string>();
  public readonly topics = new Map<string, Located<Topic>>();
  public readonly sources = new Map<string, Located<CorpusSource>>();
  public readonly guides = new Map<string, Located<CorpusExaminationGuide>>();
  public readonly entries = new Map<string, Located<CorpusEntry>>();
  public readonly citations = new Map<string, SourceChild<Citation>>();
  public readonly locators = new Map<string, SourceChild<Locator>>();
  public readonly images = new Map<string, SourceChild<Image>>();
  public readonly taxonomies: Array<Located<CorpusTaxonomy>> = [];
  public readonly releases: Array<Located<CorpusRelease>> = [];
  public readonly queries: Array<Located<CorpusQueries>> = [];
  public readonly documents: ReadonlyMap<string, string>;

  /** @param documents exact input files indexed by relative paths */
  constructor(documents: readonly CorpusDocument[]) {
    this.documents = new Map(
      documents.map((document) => [document.path, document.text]),
    );
  }

  /**
   * records a failed invariant at its owning file and JSON path
   * @param condition whether the required invariant holds
   * @param location owning file and JSON path for diagnostics
   * @param problem stable failure code and human-readable explanation
   */
  public check(
    condition: boolean,
    location: Pick<Located<unknown>, 'file' | 'path'>,
    problem: Pick<CorpusIssue, 'code' | 'message'>,
  ): void {
    if (!condition) {
      this.issues.push({
        file: location.file,
        path: location.path,
        ...problem,
      });
    }
  }

  /**
   * registers a globally unique content identity
   * @param id stable namespaced content identity
   * @param location owning file and JSON path for diagnostics
   */
  public identity(id: string, location: Located<unknown>): void {
    this.check(!this.identities.has(id), location, {
      code: 'duplicate_id',
      message: `Duplicate ID: ${id}`,
    });
    this.identities.add(id);
  }
}

/**
 * indexes validated files and their globally named records
 * @param context reference graph under construction
 * @param record parsed file and its location
 */
export function indexFile(
  context: CorpusContext,
  record: Located<CorpusFile>,
): void {
  const file = record.value;
  switch (file.kind) {
    case 'taxonomy':
      context.taxonomies.push({ ...record, value: file });
      file.topics.forEach((topic, index) =>
        addRecord(context, context.topics, {
          value: topic,
          file: record.file,
          path: `$.topics[${index}]`,
        }),
      );
      break;
    case 'source':
      addRecord(context, context.sources, {
        value: file,
        file: record.file,
        path: '$',
      });
      indexSourceChildren(context, file, record.file);
      break;
    case 'entry':
      addRecord(context, context.entries, {
        value: file,
        file: record.file,
        path: '$',
      });
      break;
    case 'examination_guide':
      addRecord(context, context.guides, { ...record, value: file });
      break;
    case 'release':
      context.releases.push({ ...record, value: file });
      break;
    default:
      context.queries.push({ ...record, value: file });
      file.questions.forEach((question, index) =>
        context.identity(question.id, {
          ...record,
          path: `$.questions[${index}]`,
        }),
      );
      break;
  }
}

/**
 * registers an identified node and retains its file location
 * @param context indexed corpus and diagnostic collector
 * @param index record lookup receiving this identity
 * @param record typed evidence and its owning diagnostic location
 */
function addRecord<T extends { id: string }>(
  context: CorpusContext,
  index: Map<string, Located<T>>,
  record: Located<T>,
): void {
  context.identity(record.value.id, record);
  index.set(record.value.id, record);
}

/**
 * registers source-owned locators, citations and images
 * @param context indexed corpus and diagnostic collector
 * @param source immutable provider snapshot and associated evidence
 * @param file owning corpus document path
 */
function indexSourceChildren(
  context: CorpusContext,
  source: CorpusSource,
  file: string,
): void {
  const add = <T extends { id: string }>(
    values: readonly T[],
    index: Map<string, SourceChild<T>>,
    field: string,
  ): void => {
    values.forEach((value, ordinal) => {
      const record = { value, source, file, path: `$.${field}[${ordinal}]` };
      context.identity(value.id, record);
      index.set(value.id, record);
    });
  };
  add(source.locators, context.locators, 'locators');
  add(source.citations, context.citations, 'citations');
  add(source.images, context.images, 'images');
}

/**
 * rejects repeated references or local identities with one diagnostic
 * @param context indexed corpus and diagnostic collector
 * @param values references or local identities being checked
 * @param location owning file and JSON path for diagnostics
 */
export function unique(
  context: CorpusContext,
  values: readonly string[],
  location: Located<unknown>,
): void {
  context.check(new Set(values).size === values.length, location, {
    code: 'duplicate_reference',
    message: 'References and local identities must be unique',
  });
}
