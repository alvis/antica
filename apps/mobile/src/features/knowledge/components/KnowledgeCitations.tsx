import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';

import { styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { CitationPanel } from './CitationPanel';

import type { FC } from 'react';
import type { View } from 'react-native';

import type { KnowledgeCitation } from './CitationPanel';

/** Citation controls shared by related previews and frozen message evidence. */
export type KnowledgeCitationsProps = {
  citations: KnowledgeCitation[];
  testIDPrefix: string;
};
const layout = StyleSheet.create({
  citation: {
    minHeight: 48,
    minWidth: 48,
    padding: 12,
    justifyContent: 'center',
  },
});

/**
 * Opens captured sources without replacing them with newer evidence.
 * @param props immutable citations and stable control identity
 * @param props.citations evidence returned by the server
 * @param props.testIDPrefix identity of the owning claim
 * @returns accessible controls and the existing source panel
 */
export const KnowledgeCitations: FC<KnowledgeCitationsProps> = ({
  citations,
  testIDPrefix,
}) => (
  <>
    {citations.map((citation, index) => (
      <CitationControl
        key={'citationId' in citation ? citation.citationId : citation.id}
        citation={citation}
        number={index + 1}
        testIDPrefix={testIDPrefix}
      />
    ))}
  </>
);

type CitationControlProps = Pick<KnowledgeCitationsProps, 'testIDPrefix'> & {
  citation: KnowledgeCitation;
  number: number;
};
/**
 * Keeps a citation's modal and focus target beside its trigger.
 * @param props captured citation and visible source number
 * @param props.citation complete frozen source metadata
 * @param props.number source position within this claim
 * @param props.testIDPrefix owning claim identity
 * @returns source trigger and focus-restoring modal
 */
const CitationControl: FC<CitationControlProps> = ({
  citation,
  number,
  testIDPrefix,
}) => {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const trigger = useRef<View>(null);
  const id = 'citationId' in citation ? citation.citationId : citation.id;
  const title =
    'citationId' in citation ? citation.sourceTitle : citation.source.title;
  const label = `${t('knowledgeCitation', { number })}: ${title}`;

  return (
    <>
      <Pressable
        ref={trigger}
        testID={`${testIDPrefix}-${id}`}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={layout.citation}
        onPress={() => setOpen(true)}>
        <Text style={styles.body}>{label}</Text>
      </Pressable>
      <CitationPanel
        citation={open ? citation : null}
        restoreFocus={trigger.current}
        onClose={() => setOpen(false)}
      />
    </>
  );
};
