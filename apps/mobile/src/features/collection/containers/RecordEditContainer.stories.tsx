import { useMemo, useRef } from 'react';

import { recordDetailSchema } from '@antica/contracts';

import {
  MobileStoryShell,
  storyRecord,
} from '../../../mobile.stories.fixtures';
import {
  findStoryElement,
  findStoryText,
  setStoryInputValue,
} from '../../../mobile.stories.helpers';

import { RecordEditContainer } from './RecordEditContainer';

import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import type { ReactElement } from 'react';

import type { InterfaceLanguagePreference } from '../../../i18n/preferences';
import type { StoryResponses } from '../../../mobile.stories.fixtures';

import type { RecordEditContainerProps } from './RecordEditContainer';

const emptyPage = { items: [], nextCursor: null };
const patchPath = `PATCH /v1/records/${storyRecord.id}`;

/** a record nobody has described yet: every field is unknown */
const unknownRecord = recordDetailSchema.parse({
  ...storyRecord,
  name: null,
  pieceCount: null,
  period: null,
  dimensions: {},
  location: { locationId: null, detail: '' },
  tags: [],
  description: '',
  collectorJudgment: null,
});

/** the same record after another device renamed it */
const renamedRecord = recordDetailSchema.parse({
  ...storyRecord,
  name: 'Blue-and-white bowl (catalogued)',
  recordRevision: storyRecord.recordRevision + 1,
});

/**
 * builds the editor's lookups around one record response
 * @param record record response or a factory serving it
 * @param patch PATCH response or a factory serving it
 * @returns story responses for the editor
 */
function editorResponses(
  record: StoryResponses[string],
  patch: StoryResponses[string],
): StoryResponses {
  return {
    [`GET /v1/records/${storyRecord.id}`]: record,
    [patchPath]: patch,
    'GET /v1/locations': [],
    'GET /v1/knowledge': emptyPage,
  };
}

/**
 * types into an editor field rendered on the story canvas
 * @param canvas story canvas root
 * @param field field automation identifier without the `record-edit-field-` prefix
 * @param value typed text
 */
async function typeInto(
  canvas: HTMLElement,
  field: string,
  value: string,
): Promise<void> {
  const input = await findStoryElement(
    canvas,
    `[data-testid="record-edit-field-${field}"]`,
  );
  input.focus();
  setStoryInputValue(input, value);
}

/**
 * presses an element of the story canvas by its automation identifier
 * @param canvas story canvas root
 * @param testID automation identifier
 */
async function pressStoryElement(
  canvas: HTMLElement,
  testID: string,
): Promise<void> {
  (await findStoryElement(canvas, `[data-testid="${testID}"]`)).click();
}

/**
 * renders an editor whose save meets a record renamed elsewhere, once
 * @param props story properties
 * @param props.locale interface language of the story
 * @param props.recordId record being edited
 * @returns the editor with a racing server
 */
function ConflictStory({
  locale,
  ...args
}: Readonly<
  RecordEditContainerProps & { locale?: InterfaceLanguagePreference }
>): ReactElement {
  const reads = useRef(0);
  const patches = useRef(0);
  const responses = useMemo(
    () =>
      editorResponses(
        () => (reads.current++ === 0 ? storyRecord : renamedRecord),
        () =>
          patches.current++ === 0
            ? {
                storyError: {
                  status: 409,
                  code: 'REVISION_CONFLICT',
                  message: 'Record changed since it was opened',
                },
              }
            : renamedRecord,
      ),
    [],
  );

  return (
    <MobileStoryShell locale={locale} responses={responses}>
      <RecordEditContainer {...args} />
    </MobileStoryShell>
  );
}

const meta = {
  title: 'Mobile/Features/Collection/RecordEditContainer',
  component: RecordEditContainer,
  tags: ['autodocs'],
  parameters: { layout: 'fullscreen' },
  args: { recordId: storyRecord.id },
  argTypes: {
    recordId: {
      control: 'text',
      description: 'Collection record identifier loaded from the API.',
    },
  },
} satisfies Meta<typeof RecordEditContainer>;

export default meta;
type Story = StoryObj<typeof meta>;

/** FR-2: every field of a described record, saved as changed fields only */
export const Editor = {
  render: (args) => (
    <MobileStoryShell responses={editorResponses(storyRecord, storyRecord)}>
      <RecordEditContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await typeInto(canvasElement, 'name', 'Blue-and-white bowl, edited');
    await pressStoryElement(canvasElement, 'record-edit-save');
    await findStoryText(canvasElement, patchPath);
  },
} satisfies Story;

/** an undescribed record: each field starts empty and stays unknown when left alone */
export const UnknownRecord = {
  render: (args) => (
    <MobileStoryShell responses={editorResponses(unknownRecord, unknownRecord)}>
      <RecordEditContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await findStoryElement(canvasElement, '[data-testid="record-edit"]');
    await findStoryText(canvasElement, 'Not set');
  },
} satisfies Story;

/** values that cannot be saved are explained beside their fields */
export const InvalidValues = {
  render: (args) => (
    <MobileStoryShell responses={editorResponses(storyRecord, storyRecord)}>
      <RecordEditContainer {...args} />
    </MobileStoryShell>
  ),
  play: async ({ canvasElement }) => {
    await typeInto(canvasElement, 'height', '0');
    await typeInto(canvasElement, 'purchase', '1200');
    await pressStoryElement(canvasElement, 'record-edit-save');
    await findStoryElement(
      canvasElement,
      '[data-testid="record-edit-field-height-error"]',
    );
    await findStoryText(canvasElement, 'Add the currency of this amount.');
  },
} satisfies Story;

/** PT-4: the name changed elsewhere, so the collector compares and chooses per field */
export const Conflict = {
  render: (args) => <ConflictStory {...args} />,
  play: async ({ canvasElement }) => {
    await typeInto(canvasElement, 'name', 'My bowl');
    await pressStoryElement(canvasElement, 'record-edit-save');
    await findStoryElement(
      canvasElement,
      '[data-testid="record-edit-conflict-name"]',
    );
    await findStoryText(canvasElement, 'Blue-and-white bowl (catalogued)');
    await pressStoryElement(
      canvasElement,
      'record-edit-conflict-keep-mine-name',
    );
    await pressStoryElement(canvasElement, 'record-edit-conflict-save');
    // the refused save, the re-read of the record, then the save with the choices
    await findStoryText(
      canvasElement,
      `${patchPath} · GET /v1/records/${storyRecord.id} · ${patchPath}`,
    );
  },
} satisfies Story;

/** the conflict view in Traditional Chinese */
export const ConflictInTraditionalChinese = {
  render: (args) => <ConflictStory locale="zh-Hant" {...args} />,
  play: async ({ canvasElement }) => {
    await typeInto(canvasElement, 'name', '我的碗');
    await pressStoryElement(canvasElement, 'record-edit-save');
    await findStoryElement(
      canvasElement,
      '[data-testid="record-edit-conflict-name"]',
    );
    await findStoryText(canvasElement, '保留我的');
  },
} satisfies Story;
