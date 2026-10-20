import { useEffect, useRef, useState } from 'react';

import {
  AccessibilityInfo,
  findNodeHandle,
  Modal,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { openKnowledgeSource } from '../api/knowledge';

import type { FC, RefObject } from 'react';

import type {
  KnowledgeContentEnvelopeV2,
  KnowledgeEvidenceSnapshotV1,
} from '@antica/contracts';

/** Captured citation metadata from either an entry or an immutable reply snapshot. */
export type KnowledgeCitation =
  | KnowledgeContentEnvelopeV2['citations'][number]
  | KnowledgeEvidenceSnapshotV1['entries'][number]['claims'][number]['citations'][number];

/** locatable citation metadata and focus restoration target */
export type CitationPanelProps = {
  citation: KnowledgeCitation | null;
  onClose: () => void;
  restoreFocus: View | null;
};

/**
 * presents the captured evidence even when its remote page disappears
 * @param root0 component properties
 * @param root0.citation citation property
 * @param root0.onClose onClose property
 * @param root0.restoreFocus restoreFocus property
 * @returns rendered knowledge content
 */
export const CitationPanel: FC<CitationPanelProps> = ({
  citation,
  onClose,
  restoreFocus,
}) => {
  const heading = useRef<View>(null);
  const wasOpen = useRef(Boolean(citation));
  const close = (): void => {
    onClose();
  };
  useEffect(() => {
    if (wasOpen.current && !citation && restoreFocus) {
      restoreFocus.focus();
      const handle =
        Platform.OS === 'web' ? null : findNodeHandle(restoreFocus);
      if (handle) {
        AccessibilityInfo.setAccessibilityFocus(handle);
      }
    }
    wasOpen.current = Boolean(citation);
  }, [citation, restoreFocus]);
  if (!citation) {
    return null;
  }

  return (
    <Modal
      visible
      transparent={false}
      animationType="none"
      onRequestClose={close}
      onShow={() => {
        heading.current?.focus();
        const handle =
          Platform.OS === 'web' ? null : findNodeHandle(heading.current);
        if (handle) {
          AccessibilityInfo.setAccessibilityFocus(handle);
        }
      }}>
      <CitationContent citation={citation} close={close} heading={heading} />
    </Modal>
  );
};

/**
 * retains captured quotes and precise locators even if a source disappears
 * @param props active evidence and modal controls
 * @param props.citation captured evidence
 * @param props.close explicit dismiss action
 * @param props.heading modal heading focus target
 * @returns source metadata and safe actions
 */
const CitationContent: FC<{
  citation: NonNullable<CitationPanelProps['citation']>;
  close: () => void;
  heading: RefObject<View | null>;
}> = ({ citation, close, heading }) => {
  const { t } = useLocale();
  const [failed, setFailed] = useState(false);
  const frozen = 'citationId' in citation;
  const id = frozen ? citation.citationId : citation.id;
  const url = frozen
    ? citation.sourcePageUrl
    : citation.locator.kind === 'page'
      ? citation.source.canonicalUrl
      : citation.locator.url;
  const quote = frozen ? citation.excerpt : citation.quote;
  const excerpt = frozen ? citation.excerpt : citation.locator.excerpt;

  return (
    <ScrollView
      testID={`knowledge-citation-panel-${id}`}
      accessibilityViewIsModal
      contentContainerStyle={styles.content}>
      <CitationMetadata citation={citation} heading={heading} />
      <Text accessibilityRole="header" style={styles.heading}>
        {t('knowledgeSourceQuote')}
      </Text>
      <Text selectable style={styles.body}>
        {quote}
      </Text>
      <Text selectable style={styles.body}>
        {excerpt}
      </Text>
      {url && (
        <ActionButton
          testID={`knowledge-source-open-${id}`}
          label={t('knowledgeOpenSource')}
          onPress={() => {
            void openKnowledgeSource(url).catch(() => setFailed(true));
          }}
        />
      )}
      {failed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('knowledgeSourceUnavailable')}
        </Text>
      )}
      <ActionButton label={t('knowledgeClose')} onPress={close} secondary />
    </ScrollView>
  );
};

/**
 * preserves institution, version and exact captured location
 * @param props immutable source metadata
 * @param props.citation captured evidence and locator
 * @param props.heading modal focus target
 * @returns title, contributors and original source identity
 */
const CitationMetadata: FC<{
  citation: NonNullable<CitationPanelProps['citation']>;
  heading: RefObject<View | null>;
}> = ({ citation, heading }) => {
  const { t } = useLocale();
  if ('citationId' in citation) {
    return <FrozenCitationMetadata citation={citation} heading={heading} />;
  }
  const { source, locator } = citation;
  const location =
    locator.kind === 'structured'
      ? `${locator.provider} · ${locator.objectId} · ${locator.fieldPath}`
      : locator.kind === 'web'
        ? (locator.section ?? locator.url)
        : t('knowledgePageLocation', {
            page: locator.printedPageLabel ?? locator.pageIndex + 1,
          });

  return (
    <>
      <View ref={heading} tabIndex={-1} accessibilityRole="header">
        <Text style={styles.heading}>{source.title}</Text>
      </View>
      <Text style={styles.body}>{source.contributors.join(' · ')}</Text>
      {source.structuredSnapshot && (
        <Text style={styles.body}>
          {t('knowledgeProvider', {
            provider: source.structuredSnapshot.provider,
          })}
        </Text>
      )}
      <Text style={styles.secondary}>
        {t('knowledgeSourceVersion', { version: source.versionId })}
      </Text>
      <Text style={styles.body}>
        {t('knowledgeCitationLocator', { locator: location })}
      </Text>
    </>
  );
};

/**
 * Presents only the source metadata captured with the historical answer.
 * @param props frozen citation and focus target
 * @param props.citation captured provider, version and location
 * @param props.heading accessible modal heading
 * @returns frozen source identity
 */
const FrozenCitationMetadata: FC<{
  citation: KnowledgeEvidenceSnapshotV1['entries'][number]['claims'][number]['citations'][number];
  heading: RefObject<View | null>;
}> = ({ citation, heading }) => {
  const { t } = useLocale();

  return (
    <>
      <View ref={heading} tabIndex={-1} accessibilityRole="header">
        <Text style={styles.heading}>{citation.sourceTitle}</Text>
      </View>
      {citation.provider && (
        <Text style={styles.body}>
          {t('knowledgeProvider', { provider: citation.provider })}
        </Text>
      )}
      <Text style={styles.secondary}>
        {t('knowledgeSourceVersion', { version: citation.sourceVersionId })}
      </Text>
      <Text style={styles.body}>
        {t('knowledgeCitationLocator', {
          locator: [
            citation.objectId,
            citation.fieldPath,
            citation.pageLabel,
            citation.section,
            citation.locatorId,
          ]
            .filter(Boolean)
            .join(' · '),
        })}
      </Text>
    </>
  );
};
