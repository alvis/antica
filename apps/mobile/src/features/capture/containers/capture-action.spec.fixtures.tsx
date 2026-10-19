import { expect } from '@jest/globals';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';

import { analysisRunDetailSchema } from '@antica/contracts';

import { collectionRecord } from '../../../mobile.spec.fixtures';
import { runId } from '../../../saved-analysis.spec.fixtures';

import {
  actionId,
  actionableRun,
} from '../../analysis/containers/analysis.spec.fixtures';

import type { MobileResponses } from '../../../mobile.spec.fixtures';

/** photo the capture uploads */
export const assetId = '00000000-0000-4000-8000-000000000022';
/** evidence anchor the photo becomes */
export const anchorId = '00000000-0000-4000-8000-000000000023';
/** check the answered action names */
export const checkId = '00000000-0000-4000-8000-000000000033';
/** observation the confirmed words become */
export const observationId = '00000000-0000-4000-8000-000000000034';
/** route that resolves the answered action */
export const actionPath = `/v1/analyses/${runId}/actions/${actionId}`;
/** buttons pressed from the media step to the review step: media, grid, words, details */
const stepsBeforeSave = ['Continue', 'Next', 'Continue', 'Continue'];

/**
 * builds the run of an action answered by this capture
 * @param action action fields replacing the fixture's describe action
 * @param status saved action state
 * @returns a parsed run detail
 */
export function runWith(
  action: Record<string, unknown>,
  status: 'pending' | 'supplied' = 'pending',
): ReturnType<typeof analysisRunDetailSchema.parse> {
  return analysisRunDetailSchema.parse({
    ...actionableRun,
    result: {
      ...actionableRun.result,
      actionStates: actionableRun.result.actionStates.map((state) => ({
        ...state,
        status,
      })),
      output: {
        ...actionableRun.result.output,
        nextActions: [
          { ...actionableRun.result.output!.nextActions[0], ...action },
        ],
      },
    },
  });
}

/** a photo action replacing the fixture's describe action */
export const photoAction = {
  kind: 'capturePhoto',
  instruction: 'Photograph the entire base',
};

/**
 * answers capture reads for a record, its new photo, and the action's run
 * @param run run read for the answered action
 * @returns read responses
 */
export function readsFor(
  run: ReturnType<typeof runWith>,
): NonNullable<MobileResponses['get']> {
  return async (path) =>
    path === '/v1/locations'
      ? []
      : path === `/v1/media/${assetId}`
        ? { asset: { views: [{ id: assetId }] } }
        : path === `/v1/analyses/${runId}`
          ? run
          : collectionRecord;
}

/**
 * walks a resumed capture from its media step to Save
 * @returns resolves once Save has been pressed
 */
export async function importAndSave(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Import file' })).toBeTruthy(),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Import file' }));
  for (const name of stepsBeforeSave) {
    await fireEvent.press(screen.getByRole('button', { name }));
  }
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
}
