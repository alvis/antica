import { describe, expect, it, jest } from '@jest/globals';

import { entry } from './containers/record-messages.spec.fixtures';
import { threadRows } from './thread-rows';

jest.mock('../../../providers/AuthProvider', () => ({ useAuth: jest.fn() }));

const at = (time: string): string => new Date(time).toISOString();

describe('fn:threadRows', () => {
  it('should show a time chip before the first message only while the conversation continues', () => {
    const first = entry('collector', 'a', {}, at('2026-10-20T10:00:00'));
    const second = entry('assistant', 'b', {}, at('2026-10-20T10:29:00'));

    expect(
      threadRows([first, second], undefined).map((row) => row.kind),
    ).toEqual(['time', 'message', 'message']);
  });

  it('should show a time chip again after a pause longer than 30 minutes', () => {
    const first = entry('collector', 'a', {}, at('2026-10-20T10:00:00'));
    const second = entry('assistant', 'b', {}, at('2026-10-20T10:31:00'));

    expect(threadRows([first, second], undefined)).toEqual([
      { kind: 'time', id: `time-${first.id}`, at: first.createdAt },
      { kind: 'message', id: first.id, entry: first },
      { kind: 'time', id: `time-${second.id}`, at: second.createdAt },
      { kind: 'message', id: second.id, entry: second },
    ]);
  });

  it('should show a time chip when the conversation resumes on another day within 30 minutes', () => {
    const first = entry('collector', 'a', {}, at('2026-10-20T23:50:00'));
    const second = entry('assistant', 'b', {}, at('2026-10-21T00:05:00'));

    expect(
      threadRows([first, second], undefined).map((row) => row.kind),
    ).toEqual(['time', 'message', 'time', 'message']);
  });

  it('should place a running analysis last even when it started before the messages', () => {
    const first = entry('collector', 'a', {}, at('2026-10-20T10:00:00'));
    const second = entry('assistant', 'b', {}, at('2026-10-20T10:05:00'));
    const rows = threadRows([first, second], {
      runId: 'run-1',
      phase: 'running',
      at: at('2026-10-20T09:00:00'),
    });

    expect(rows.at(-1)).toEqual({
      kind: 'analysis',
      id: 'analysis-run-1',
      analysis: {
        runId: 'run-1',
        phase: 'running',
        at: at('2026-10-20T09:00:00'),
      },
    });
  });

  it('should place a finished analysis among the messages by its time', () => {
    const first = entry('collector', 'a', {}, at('2026-10-20T10:00:00'));
    const second = entry('assistant', 'b', {}, at('2026-10-20T10:10:00'));
    const rows = threadRows([first, second], {
      runId: 'run-1',
      phase: 'finished',
      at: at('2026-10-20T10:05:00'),
    });

    expect(
      rows.filter((row) => row.kind !== 'time').map((row) => row.id),
    ).toEqual([first.id, 'analysis-run-1', second.id]);
  });

  it('should place a finished analysis without a time last', () => {
    const first = entry('collector', 'a', {}, at('2026-10-20T10:00:00'));

    expect(
      threadRows([first], { runId: 'run-1', phase: 'finished' }).map(
        (row) => row.id,
      ),
    ).toEqual([`time-${first.id}`, first.id, 'analysis-run-1']);
  });
});
