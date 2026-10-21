import { emulatorUtcOffset } from '../fixtures.js';

import type { DemoRecordKey } from '../fixtures.js';

/** reply segment of the assistant, grounded in saved corpus claims */
export interface DemoReplySegment {
  readonly text: string;
  /** corpus claims, as `<content id>#<claim key>` */
  readonly evidence: readonly string[];
}

/** a record conversation whose edit draft waits for the collector */
export interface DemoConversation {
  readonly record: DemoRecordKey;
  /** collector message time in the emulator's local time with its offset */
  readonly createdAt: string;
  readonly collectorMessage: string;
  readonly reply: readonly DemoReplySegment[];
  readonly proposals: ReadonlyArray<
    | { readonly field: 'name'; readonly proposed: string }
    | {
        readonly field: 'materialIds';
        readonly proposedTerms: readonly string[];
      }
  >;
}

/** the chair conversation and its ready edit card */
export const demoConversation: DemoConversation = {
  record: 'chair',
  createdAt: `2026-10-20T09:02:00${emulatorUtcOffset}`,
  collectorMessage: '這張是黃花梨圈椅，名稱和材質幫我改一下。',
  reply: [
    {
      text: '可以。不過館藏記錄裡的「黃花梨」是材名，不是木材鑑定，材質我建議寫成「黃花梨（未經木材鑑定）」。',
      evidence: [
        'antica:entry:furniture:huanghuali-material#aic-huanghuali-designation',
      ],
    },
    {
      text: '名稱可參照同型館藏圈椅，寫成「黃花梨羅漢式圈椅」。兩項都要您逐項確認後才寫入。',
      evidence: ['antica:entry:furniture:lohan-chair#record-identity'],
    },
  ],
  proposals: [
    { field: 'name', proposed: '黃花梨羅漢式圈椅' },
    { field: 'materialIds', proposedTerms: ['黃花梨（未經木材鑑定）'] },
  ],
};
