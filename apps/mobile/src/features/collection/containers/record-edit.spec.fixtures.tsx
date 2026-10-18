import { fireEvent, screen } from '@testing-library/react-native';

import { ApiError } from '@antica/client';
import { recordDetailSchema, recordPatchSchema } from '@antica/contracts';

import { renderMobile } from '../../../mobile.spec.fixtures';

import {
  knowledgeDetail,
  knowledgePage,
  locations,
  materialId,
  objectTypeId,
  otherMaterialId,
  receipt,
} from '../record-edit.spec.fixtures';

import { RecordEditContainer } from './RecordEditContainer';

import type { ReactElement } from 'react';

import type { RecordDetail, RecordPatch } from '@antica/contracts';

import type {
  MobileDevice,
  MobileHarness,
} from '../../../mobile.spec.fixtures';

/** an in-memory record API that enforces revisions like the real one */
export type RecordServer = {
  /** the record as the server holds it */
  record: RecordDetail;
  /** PATCH bodies received, in order */
  readonly bodies: RecordPatch[];
  /** idempotency keys received, in order */
  readonly keys: Array<string | undefined>;
  /** changes the record as another writer would, raising its revision */
  change: (fields?: Partial<RecordDetail>) => void;
  /** runs before each PATCH is applied, as a writer racing the save would */
  beforePatch?: (attempt: number) => void;
};

/**
 * creates an in-memory record API
 * @param record record the server starts with
 * @returns the server state and its controls
 */
export function recordServer(record: RecordDetail): RecordServer {
  const server: RecordServer = {
    record,
    bodies: [],
    keys: [],
    change: (fields = {}) => {
      server.record = recordDetailSchema.parse({
        ...server.record,
        ...fields,
        recordRevision: server.record.recordRevision + 1,
      });
    },
  };

  return server;
}

/**
 * answers the editor's reads from the server state
 * @param server record API state
 * @param path requested path
 * @returns the response body
 */
function read(server: RecordServer, path: string): unknown {
  if (path === `/v1/records/${server.record.id}`) {
    return server.record;
  }
  if (path === '/v1/locations') {
    return locations;
  }
  if (path.startsWith('/v1/knowledge?')) {
    return path.includes('kinds=material')
      ? knowledgePage([
          { id: materialId, title: 'Porcelain' },
          { id: otherMaterialId, title: 'Stoneware' },
        ])
      : knowledgePage([{ id: objectTypeId, title: 'Bowl' }]);
  }
  if (path.startsWith('/v1/knowledge/')) {
    const id = path.slice('/v1/knowledge/'.length);

    return knowledgeDetail(id, id === objectTypeId ? 'Bowl' : 'Porcelain');
  }

  return receipt;
}

/**
 * applies a PATCH when its revision is current, and rejects it as a conflict otherwise
 * @param server record API state
 * @param options request options the transport received
 * @returns the saved record
 */
function patch(server: RecordServer, options: unknown): RecordDetail {
  const { body, idempotencyKey } = options as {
    body: unknown;
    idempotencyKey?: string;
  };
  const input = recordPatchSchema.parse(body);
  server.bodies.push(input);
  server.keys.push(idempotencyKey);
  server.beforePatch?.(server.bodies.length);
  if (input.expectedRevision !== server.record.recordRevision) {
    throw new ApiError({
      status: 409,
      code: 'REVISION_CONFLICT',
      message: 'Record changed since it was opened',
      retryable: true,
    });
  }
  server.change(input.fields);

  return server.record;
}

/**
 * renders the editor against an in-memory record API
 * @param server record API state
 * @param element screen to render; defaults to the editor
 * @param device device-local state
 * @returns the harness
 */
export async function renderEditor(
  server: RecordServer,
  element: ReactElement = <RecordEditContainer recordId={server.record.id} />,
  device?: MobileDevice,
): Promise<MobileHarness> {
  const view = await renderMobile(
    element,
    {
      get: async (path) => read(server, path),
      post: async () => ({ id: locations[0].id, label: locations[0].label }),
    },
    device,
  );
  view.patches.mockImplementation(async (_path, _schema, options) =>
    patch(server, options),
  );
  await screen.findByTestId('record-edit');

  return view;
}

/**
 * types into an editor field
 * @param id field automation identifier without the `record-edit-field-` prefix
 * @param text typed text
 */
export async function type(id: string, text: string): Promise<void> {
  await fireEvent.changeText(
    screen.getByTestId(`record-edit-field-${id}`),
    text,
  );
}

/**
 * presses an element by its automation identifier
 * @param id automation identifier
 */
export async function press(id: string): Promise<void> {
  await fireEvent.press(screen.getByTestId(id));
}
