/** a paging cursor was not produced by the message repository */
export class RecordMessageCursorError extends Error {
  constructor() {
    super('Record message cursor is invalid');
    this.name = 'RecordMessageCursorError';
  }
}
