/** a request key was replayed with a different record, edit draft, or body */
export class RecordMessageReplayConflictError extends Error {
  constructor() {
    super('Record message request key was reused for a different message');
    this.name = 'RecordMessageReplayConflictError';
  }
}
