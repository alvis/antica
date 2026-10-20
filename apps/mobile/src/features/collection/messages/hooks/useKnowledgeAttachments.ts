import { useState } from 'react';

import type { KnowledgeAttachment } from '@antica/contracts';

import type { ComposerKnowledgeAttachment } from './useMessageComposer';

/** Contract grounding caps shared with candidate eligibility. */
export const knowledgeClaimLimit = 6;
export const knowledgeEntryLimit = 3;

/** Collector-owned attachment selection and its explicit mutations. */
interface KnowledgeAttachmentSelection {
  attachments: ComposerKnowledgeAttachment[];
  references: KnowledgeAttachment[] | undefined;
  attach: (reference: KnowledgeAttachment, title: string) => void;
  remove: (reference: KnowledgeAttachment) => void;
  clear: () => void;
}

/**
 * Keeps selected claims visible and stable until a successful explicit send.
 * @param busy locks changes during a post
 * @returns bounded selection actions
 */
export function useKnowledgeAttachments(
  busy: boolean,
): KnowledgeAttachmentSelection {
  const [attachments, setAttachments] = useState<ComposerKnowledgeAttachment[]>(
    [],
  );

  return {
    attachments,
    references: attachments.length
      ? attachments.map((item) => item.reference)
      : undefined,
    attach: (reference, title) => {
      if (busy) {
        return;
      }
      setAttachments((current) => {
        const entries = new Set(current.map((item) => item.reference.entryId));
        if (
          current.length >= knowledgeClaimLimit ||
          (entries.size >= knowledgeEntryLimit &&
            !entries.has(reference.entryId)) ||
          current.some(
            (item) =>
              item.reference.entryId === reference.entryId &&
              item.reference.revision === reference.revision &&
              item.reference.claimKey === reference.claimKey,
          )
        ) {
          return current;
        }

        return [...current, { reference, title }];
      });
    },
    remove: (reference) => {
      if (!busy) {
        setAttachments((current) =>
          current.filter((item) => item.reference !== reference),
        );
      }
    },
    clear: () => setAttachments([]),
  };
}
