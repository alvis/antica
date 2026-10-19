import { useQuery, useQueryClient } from '@tanstack/react-query';

import { randomUUID } from 'expo-crypto';

import { useRouter } from 'expo-router';

import { useState } from 'react';

import { Linking, Text, View } from 'react-native';

import {
  noteInputSchema,
  noteSchema,
  researchDetailSchema,
} from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { localizeStatus } from '../../../i18n/messages';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

export type ResearchDetailContainerProps = { researchId: string };

export const ResearchDetailContainer: FC<ResearchDetailContainerProps> = ({
  researchId,
}) => {
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState<string | null>(null);
  const [paragraphs, setParagraphs] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const detail = useQuery({
    queryKey: ['research-detail', researchId],
    queryFn: async ({ signal }) =>
      api.get(`/v1/research/${researchId}`, researchDetailSchema, signal),
    refetchInterval: (query) =>
      ['queued', 'running', 'waiting'].includes(
        query.state.data?.state.kind ?? '',
      )
        ? 4000
        : false,
  });

  const save = async (): Promise<void> => {
    const data = detail.data;
    if (!data?.draft || busy) {
      return;
    }
    setBusy(true);
    setError('');
    try {
      const input = noteInputSchema.parse({
        requestKey: randomUUID(),
        researchId,
        expectedDraftRevision: data.draft.revision,
        titleZhHant: title ?? data.draft.titleZhHant,
        paragraphs: data.draft.paragraphs.map((item, index) => ({
          ...item,
          textZhHant: paragraphs[index] ?? item.textZhHant,
        })),
        citations: data.draft.citations,
        recordId: data.request.recordId,
        entryId: data.request.entryId,
      });
      await api.post('/v1/notes', noteSchema, {
        body: input,
        idempotencyKey: input.requestKey,
      });
      await queryClient.invalidateQueries({
        queryKey: ['research-detail', researchId],
      });
      setTitle(null);
      setParagraphs({});
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title={t('research')}
      subtitle={
        detail.data ? localizeStatus(detail.data.state.kind, t) : undefined
      }>
      <QueryState
        loading={detail.isPending}
        error={detail.error}
        retry={() => void detail.refetch()}>
        {detail.data && (
          <>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('question')}</Text>
              <Text style={styles.body}>
                {detail.data.request.instructionZhHant}
              </Text>
              <Text style={styles.secondary}>
                {localizeStatus(detail.data.state.kind, t)} ·{' '}
                {detail.data.request.scope === 'curated_only'
                  ? t('curatedOnly')
                  : t('curatedWeb')}
              </Text>
              {detail.data.warningsZhHant.map((warning, index) => (
                <Text key={index} style={styles.error}>
                  {warning}
                </Text>
              ))}
            </View>
            <View style={styles.card}>
              <Text style={styles.heading}>{t('sources')}</Text>
              {detail.data.sourceIds.map((id) => (
                <ActionButton
                  key={id}
                  label={t('viewSourceWithId', { id: id.slice(0, 8) })}
                  onPress={() => router.push(`/sources/${id}`)}
                  secondary
                />
              ))}
              {detail.data.sourceIds.length === 0 && (
                <Text style={styles.secondary}>{t('empty')}</Text>
              )}
            </View>
            {detail.data.draft && (
              <View style={styles.card}>
                <Text style={styles.heading}>{t('saveNote')}</Text>
                <TextField
                  label={t('name')}
                  value={title ?? detail.data.draft.titleZhHant}
                  onChangeText={setTitle}
                />
                {detail.data.draft.paragraphs.map((item, index) => (
                  <View key={index}>
                    <TextField
                      label={t('descriptionNumber', { number: index + 1 })}
                      value={paragraphs[index] ?? item.textZhHant}
                      onChangeText={(value) =>
                        setParagraphs((current) => ({
                          ...current,
                          [index]: value,
                        }))
                      }
                      multiline
                    />
                    <Text style={styles.secondary}>
                      {item.support === 'needs_source'
                        ? t('sourceNeedsReview')
                        : t('citationCount', {
                            count: item.citationIds.length,
                          })}
                    </Text>
                  </View>
                ))}
                {detail.data.draft.citations.map((citation) => (
                  <ActionButton
                    key={citation.id}
                    label={t('viewSourceWithId', {
                      id: citation.id.slice(0, 8),
                    })}
                    onPress={() =>
                      citation.locator.kind === 'page'
                        ? router.push(
                            `/sources/${citation.locator.sourceId}?versionId=${citation.locator.sourceVersionId}&pageId=${citation.locator.pageId}`,
                          )
                        : void Linking.openURL(citation.locator.url)
                    }
                    secondary
                  />
                ))}
                <ActionButton
                  label={t('saveNote')}
                  onPress={() => void save()}
                  disabled={busy}
                />
              </View>
            )}
            {detail.data.notes.map((note) => (
              <View key={note.id} style={styles.card}>
                <Text style={styles.heading}>{note.titleZhHant}</Text>
                {note.paragraphs.map((paragraph, index) => (
                  <Text key={index} style={styles.body}>
                    {paragraph.textZhHant}
                  </Text>
                ))}
              </View>
            ))}
          </>
        )}
      </QueryState>
      {Boolean(error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Screen>
  );
};
