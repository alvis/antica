import { useQuery } from '@tanstack/react-query';

import { useRouter } from 'expo-router';

import { useState } from 'react';

import { Image, Linking, Text, View } from 'react-native';

import { sourceDetailSchema } from '@antica/contracts';
import { ActionButton, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../i18n/LocaleProvider';
import { localizeStatus } from '../../../i18n/messages';
import { useAuth } from '../../../providers/AuthProvider';

import type { FC } from 'react';

export type SourceDetailContainerProps = {
  sourceId: string;
  versionId?: string;
  pageId?: string;
};

export const SourceDetailContainer: FC<SourceDetailContainerProps> = ({
  sourceId,
  versionId,
  pageId,
}) => {
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useLocale();
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const [openError, setOpenError] = useState('');
  const parameters = new URLSearchParams({ limit: '20' });
  if (versionId) {
    parameters.set('versionId', versionId);
  }
  if (pageId) {
    parameters.set('pageId', pageId);
  }
  if (pageCursor) {
    parameters.set('pageCursor', pageCursor);
  }
  const detail = useQuery({
    queryKey: ['source', sourceId, versionId, pageId, pageCursor],
    queryFn: async ({ signal }) =>
      api.get(
        `/v1/sources/${sourceId}?${parameters}`,
        sourceDetailSchema,
        signal,
      ),
  });

  const openOriginalPdf = async (assetId: string): Promise<void> => {
    setOpenError('');
    try {
      const fresh = await detail.refetch();
      if (fresh.error) {
        return;
      }
      const read = fresh.data?.reads.find(
        (item) => item.assetOrDerivativeId === assetId,
      );
      if (!read) {
        throw new Error(t('sourceNeedsReview'));
      }
      await Linking.openURL(read.url);
    } catch (cause) {
      setOpenError((cause as Error).message);
    }
  };

  return (
    <Screen
      title={detail.data?.source.metadata.title ?? t('sources')}
      subtitle={
        detail.data ? localizeStatus(detail.data.version.status, t) : undefined
      }>
      <QueryState
        loading={detail.isPending}
        error={detail.error}
        retry={() => void detail.refetch()}>
        {detail.data && (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>
                {detail.data.source.metadata.title}
              </Text>
              <Text style={styles.body}>
                {detail.data.source.metadata.authorStatus === 'unknown'
                  ? t('unknownAuthor')
                  : detail.data.source.metadata.contributors
                      .map((person) => person.nameAsPrinted)
                      .join(', ')}
              </Text>
              <Text style={styles.secondary}>
                {detail.data.source.metadata.editionStatement ?? t('unknown')} ·{' '}
                {localizeStatus(detail.data.version.status, t)}
              </Text>
              {detail.data.version.status === 'partial' && (
                <Text style={styles.error}>{t('partial')}</Text>
              )}
              {detail.data.source.kind === 'book_pdf' &&
                detail.data.version.originalAssetIds.map((assetId, index) => (
                  <ActionButton
                    key={assetId}
                    label={`${t('openOriginalPdf')} ${index + 1}`}
                    onPress={() => void openOriginalPdf(assetId)}
                    secondary
                  />
                ))}
            </View>
            {detail.data.pages.items.map((page) => {
              const read = detail.data.reads.find(
                (item) => item.assetOrDerivativeId === page.view.derivativeId,
              );

              return (
                <View key={page.id} style={styles.card}>
                  <Text style={styles.heading}>
                    {t('pageOrder')} {page.pageIndex + 1} · {t('printedPage')}{' '}
                    {page.printedPageLabel ?? t('unknown')}
                  </Text>
                  {read && (
                    <Image
                      source={{ uri: read.url }}
                      style={{ width: '100%', height: 300 }}
                      resizeMode="contain"
                      accessibilityLabel={`${detail.data.source.metadata.title}, ${page.printedPageLabel ?? page.pageIndex + 1}`}
                    />
                  )}
                  <Text style={styles.secondary}>
                    {page.quality === 'needs_review'
                      ? t('sourceNeedsReview')
                      : localizeStatus(page.quality, t)}
                  </Text>
                  {page.presentation && (
                    <Text style={styles.secondary}>
                      {t('rotate')}:{' '}
                      {page.presentation.rotationQuarterTurns * 90}° ·{' '}
                      {page.presentation.crop
                        ? t('selectRegion')
                        : t('fullImage')}
                    </Text>
                  )}
                  <Text style={styles.body}>{page.rawText || t('empty')}</Text>
                </View>
              );
            })}
            {detail.data.pages.items.length === 0 && (
              <View style={styles.card}>
                <Text style={styles.secondary}>
                  {detail.data.version.status === 'failed'
                    ? t('error')
                    : t('processing')}
                </Text>
              </View>
            )}
            {detail.data.pages.nextCursor && (
              <ActionButton
                label={t('more')}
                onPress={() => setPageCursor(detail.data.pages.nextCursor)}
                secondary
              />
            )}
            <View style={styles.card}>
              <Text style={styles.heading}>{t('examples')}</Text>
              {detail.data.referenceImages.map((image) => (
                <View key={image.id} style={styles.card}>
                  {detail.data.reads
                    .filter(
                      (read) =>
                        read.assetOrDerivativeId === image.storedDerivativeId,
                    )
                    .map((read) => (
                      <Image
                        key={read.assetOrDerivativeId}
                        source={{ uri: read.url }}
                        style={{ width: '100%', height: 220 }}
                        resizeMode="contain"
                        accessibilityLabel={
                          image.originalCaption?.textAsPrinted ??
                          t('originalImage')
                        }
                      />
                    ))}
                  <Text style={styles.body}>
                    {image.originalCaption?.textAsPrinted ??
                      t('sourceNeedsReview')}
                  </Text>
                  {image.generatedDescriptionZhHant && (
                    <Text style={styles.secondary}>
                      {image.generatedDescriptionZhHant}
                    </Text>
                  )}
                </View>
              ))}
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('knowledgeDraft')}</Text>
              {detail.data.knowledgeDraftIds.map((id) => (
                <ActionButton
                  key={id}
                  label={`${t('view')} ${id.slice(0, 8)}`}
                  onPress={() => router.push(`/knowledge/${id}`)}
                  secondary
                />
              ))}
              {detail.data.knowledgeDraftIds.length === 0 && (
                <Text style={styles.secondary}>{t('processing')}</Text>
              )}
            </View>
          </>
        )}
      </QueryState>
      {Boolean(openError) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {openError}
        </Text>
      )}
    </Screen>
  );
};
