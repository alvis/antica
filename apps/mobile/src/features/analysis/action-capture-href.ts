import type { NextAction } from '@antica/contracts';

/** how the collector answers an action: with a new image or with words */
export type ActionCaptureMode = 'photo' | 'describe';

/**
 * builds the capture route pre-linked to an action and its run (C04, PT-13); capture reads the
 * action's check from the run, so a hand-edited link cannot attach evidence to another check
 * @param target record, run, and action being answered
 * @param target.recordId record that receives the new evidence
 * @param target.runId run that suggested the action
 * @param target.action action being answered
 * @param mode photo capture, or the spoken or typed observation path
 * @returns capture href naming the record, the run, and the action
 */
export function actionCaptureHref(
  target: { recordId: string; runId: string; action: NextAction },
  mode: ActionCaptureMode,
): string {
  const params = new URLSearchParams({
    recordId: target.recordId,
    runId: target.runId,
    actionId: target.action.id,
  });
  if (mode === 'describe') {
    params.set('mode', 'describe');
  }

  return `/capture?${params.toString()}`;
}
