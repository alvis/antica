import { useLocalSearchParams } from 'expo-router';
import { useRef, useState } from 'react';
import { FlatList } from 'react-native';

import { styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../providers/LocaleProvider';

import { CitationPanel } from '../components/CitationPanel';
import { KnowledgeEditor } from '../components/KnowledgeEditor';
import { KnowledgeReading } from '../components/KnowledgeReading';
import { RemoteImageReference } from '../components/RemoteImageReference';
import { useKnowledgeEntry } from '../hooks/useKnowledgeEntry';

import type { FC, ReactElement } from 'react';
import type { ViewToken, View } from 'react-native';

import type {
  KnowledgeContentEnvelopeV2,
  KnowledgeEntryDetailV2,
} from '@antica/contracts';

/** entry identity comes from the thin route */
export type KnowledgeDetailContainerProps = { entryId: string };

/**
 * presents immutable evidence before offering an explicit editor and save
 * @param root0 component properties
 * @param root0.entryId entryId property
 * @returns rendered knowledge content
 */
export const KnowledgeDetailContainer: FC<KnowledgeDetailContainerProps> = ({
  entryId,
}) => {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const { locale, t } = useLocale();
  const state = useKnowledgeEntry(
    entryId,
    view === 'working' ? 'working' : 'saved',
  );
  const { detail } = state;
  const [original, setOriginal] = useState(false);
  const [citation, setCitation] = useState<
    KnowledgeContentEnvelopeV2['citations'][number] | null
  >(null);
  const focus = useRef<View | null>(null);
  const entry = detail.data;
  const title =
    entry?.content.titles.find((item) => item.language === locale) ??
    entry?.content.titles[0];
  const subject = title?.text ?? t('knowledge');

  return (
    <Screen title={subject} scrollable={false}>
      <QueryState
        loading={detail.isPending}
        error={detail.error}
        retry={() => {
          void detail.refetch();
        }}>
        {entry && (
          <KnowledgeGallery
            entry={entry}
            caption={subject}
            header={
              <>
                <KnowledgeReading
                  entry={entry}
                  original={original}
                  setOriginal={setOriginal}
                  onCitation={(selected, trigger) => {
                    focus.current = trigger;
                    setCitation(selected);
                  }}
                />
                <KnowledgeEditor {...state} entry={entry} />
              </>
            }
          />
        )}
      </QueryState>
      <CitationPanel
        citation={citation}
        restoreFocus={focus.current}
        onClose={() => setCitation(null)}
      />
    </Screen>
  );
};

/**
 * defers transient image reads until the scrolling gallery exposes each item
 * @param props immutable images and reading header
 * @param props.entry current revision
 * @param props.caption subject of the image
 * @param props.header evidence before the gallery
 * @returns a viewport-aware scrolling reading surface
 */
const KnowledgeGallery: FC<{
  entry: KnowledgeEntryDetailV2;
  caption: string;
  header: ReactElement;
}> = ({ entry, caption, header }) => {
  const [visibleImages, setVisibleImages] = useState<string[]>([]);
  const onVisible = useRef(
    ({
      viewableItems,
    }: {
      viewableItems: Array<
        ViewToken<KnowledgeContentEnvelopeV2['images'][number]>
      >;
    }): void => setVisibleImages(viewableItems.map((item) => item.item.id)),
  );

  return (
    <FlatList
      testID="knowledge-detail"
      data={entry.content.images}
      keyExtractor={(image) => image.id}
      contentContainerStyle={styles.content}
      initialNumToRender={1}
      windowSize={3}
      maxToRenderPerBatch={2}
      onViewableItemsChanged={onVisible.current}
      ListHeaderComponent={header}
      renderItem={({ item }) => (
        <RemoteImageReference
          image={item}
          caption={caption}
          nearViewport={visibleImages.includes(item.id)}
        />
      )}
    />
  );
};
