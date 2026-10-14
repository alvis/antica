import { useQuery } from '@tanstack/react-query';

import { useRouter } from 'expo-router';

import { useState } from 'react';

import { FlatList, Image, Pressable, Text, View } from 'react-native';

import {
  knowledgePageSchema,
  locationsSchema,
  recordPageSchema,
} from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { useAuth } from '../../../auth';
import { QueryState } from '../../../components/QueryState';
import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../locale';

import type { FC } from 'react';

type Freshness = 'all' | 'unanalyzed' | 'outdated';

export type FreshnessOptionProps = {
  label: string;
  selected: boolean;
  onPress: () => void;
};

const FreshnessOption: FC<FreshnessOptionProps> = ({
  label,
  selected,
  onPress,
}) => (
  <Pressable
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ selected }}
    onPress={onPress}
    style={selected ? styles.button : styles.secondaryButton}>
    <Text style={selected ? styles.buttonText : styles.secondaryButtonText}>
      {label}
    </Text>
  </Pressable>
);

export default function CollectionRoute() {
  const router = useRouter();
  const { api } = useAuth();
  const { t } = useLocale();
  const [text, setText] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [freshness, setFreshness] = useState<Freshness>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filterKind, setFilterKind] = useState<
    'object_type' | 'material' | 'period'
  >('object_type');
  const [filterTerm, setFilterTerm] = useState('');
  const [selectedLabels, setSelectedLabels] = useState<Record<string, string>>(
    {},
  );
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [materialIds, setMaterialIds] = useState<string[]>([]);
  const [periodIds, setPeriodIds] = useState<string[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [tag, setTag] = useState('');
  const [pending, setPending] = useState(false);
  const [sort, setSort] = useState<'updated' | 'code' | 'name'>('updated');
  const parameters = new URLSearchParams({ limit: '50', sort });
  if (text.trim()) {
    parameters.set('text', text.trim());
  }
  if (cursor) {
    parameters.set('cursor', cursor);
  }
  if (freshness !== 'all') {
    parameters.set('freshness', freshness);
  }
  for (const id of categoryIds) {
    parameters.append('categoryIds', id);
  }
  for (const id of materialIds) {
    parameters.append('materialIds', id);
  }
  for (const id of periodIds) {
    parameters.append('periodIds', id);
  }
  if (locationId) {
    parameters.set('locationId', locationId);
  }
  if (tag.trim()) {
    parameters.append('tags', tag.trim());
  }
  if (pending) {
    parameters.set('hasPendingChecks', 'true');
  }
  const page = useQuery({
    queryKey: [
      'records',
      text,
      cursor,
      freshness,
      categoryIds,
      materialIds,
      periodIds,
      locationId,
      tag,
      pending,
      sort,
    ],
    queryFn: async ({ signal }) =>
      api.get(`/v1/records?${parameters}`, recordPageSchema, signal),
  });
  const locations = useQuery({
    queryKey: ['locations'],
    enabled: filtersOpen,
    queryFn: async ({ signal }) =>
      api.get('/v1/locations', locationsSchema, signal),
  });
  const taxonomyParameters = new URLSearchParams({
    q: filterTerm,
    limit: '50',
  });
  taxonomyParameters.append('kinds', filterKind);
  const taxonomy = useQuery({
    queryKey: ['filter-knowledge', filterKind, filterTerm],
    enabled: filtersOpen,
    queryFn: async ({ signal }) =>
      api.get(
        `/v1/knowledge?${taxonomyParameters}`,
        knowledgePageSchema,
        signal,
      ),
  });

  const resetPage = (): void => {
    setCursor(null);
    setCursorHistory([]);
  };

  const selectFilter = (id: string, label: string): void => {
    setSelectedLabels((current) => ({ ...current, [id]: label }));
    if (filterKind === 'object_type') {
      setCategoryIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
    }
    if (filterKind === 'material') {
      setMaterialIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
    }
    if (filterKind === 'period') {
      setPeriodIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
    }
    resetPage();
  };

  const clearFilters = (): void => {
    setText('');
    setCategoryIds([]);
    setMaterialIds([]);
    setPeriodIds([]);
    setLocationId(null);
    setTag('');
    setPending(false);
    setFreshness('all');
    resetPage();
  };

  const hasRecordFilters =
    Boolean(text.trim()) ||
    freshness !== 'all' ||
    categoryIds.length > 0 ||
    materialIds.length > 0 ||
    periodIds.length > 0 ||
    locationId !== null ||
    Boolean(tag.trim()) ||
    pending;

  return (
    <Screen title={t('collection')} scrollable={false}>
      <FlatList
        style={styles.screen}
        data={page.isPending || page.error ? [] : page.data.items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View
            style={{
              gap: styles.content.gap,
              marginBottom: styles.content.gap,
            }}>
            <View style={styles.row}>
              <ActionButton
                label={t('addItem')}
                onPress={() => router.push('/capture')}
              />
              <ActionButton
                label={t('settings')}
                onPress={() => router.push('/settings')}
                secondary
              />
            </View>
            <View style={{ gap: styles.card.gap }}>
              <ActionButton
                label={t('filters')}
                onPress={() => setFiltersOpen((value) => !value)}
                secondary
              />
              {filtersOpen && (
                <View style={styles.card}>
                  <Text style={styles.heading}>{t('filters')}</Text>
                  <View style={styles.row}>
                    <ActionButton
                      label={t('type')}
                      onPress={() => setFilterKind('object_type')}
                      secondary={filterKind !== 'object_type'}
                    />
                    <ActionButton
                      label={t('material')}
                      onPress={() => setFilterKind('material')}
                      secondary={filterKind !== 'material'}
                    />
                    <ActionButton
                      label={t('period')}
                      onPress={() => setFilterKind('period')}
                      secondary={filterKind !== 'period'}
                    />
                  </View>
                  <TextField
                    label={t('search')}
                    value={filterTerm}
                    onChangeText={setFilterTerm}
                  />
                  {taxonomy.data?.items.map((entry) => (
                    <ActionButton
                      key={entry.id}
                      label={entry.titleZhHant}
                      onPress={() => selectFilter(entry.id, entry.titleZhHant)}
                      secondary
                    />
                  ))}
                  {[...categoryIds, ...materialIds, ...periodIds].map((id) => (
                    <Text key={id} style={styles.secondary}>
                      {selectedLabels[id] ?? id}
                    </Text>
                  ))}
                  <Text style={styles.label}>{t('location')}</Text>
                  <View style={styles.row}>
                    {locations.data?.map((location) => (
                      <ActionButton
                        key={location.id}
                        label={location.label}
                        onPress={() => {
                          setLocationId(location.id);
                          resetPage();
                        }}
                        secondary={locationId !== location.id}
                      />
                    ))}
                  </View>
                  <TextField
                    label={t('tags')}
                    value={tag}
                    onChangeText={(value) => {
                      setTag(value);
                      resetPage();
                    }}
                  />
                  <ActionButton
                    label={t('pendingChecks')}
                    onPress={() => {
                      setPending((value) => !value);
                      resetPage();
                    }}
                    secondary={!pending}
                  />
                  <Text style={styles.label}>{t('sort')}</Text>
                  <View style={styles.row}>
                    <ActionButton
                      label={t('recent')}
                      onPress={() => {
                        setSort('updated');
                        resetPage();
                      }}
                      secondary={sort !== 'updated'}
                    />
                    <ActionButton
                      label={t('itemCode')}
                      onPress={() => {
                        setSort('code');
                        resetPage();
                      }}
                      secondary={sort !== 'code'}
                    />
                    <ActionButton
                      label={t('name')}
                      onPress={() => {
                        setSort('name');
                        resetPage();
                      }}
                      secondary={sort !== 'name'}
                    />
                  </View>
                  <ActionButton
                    label={t('clearFilters')}
                    onPress={clearFilters}
                    secondary
                  />
                </View>
              )}
            </View>
            <View style={{ gap: styles.card.gap }}>
              <TextField
                label={t('search')}
                value={text}
                onChangeText={(value) => {
                  setText(value);
                  resetPage();
                }}
              />
              <View style={styles.row}>
                <FreshnessOption
                  label={t('all')}
                  selected={freshness === 'all'}
                  onPress={() => {
                    setFreshness('all');
                    resetPage();
                  }}
                />
                <FreshnessOption
                  label={t('notAnalyzed')}
                  selected={freshness === 'unanalyzed'}
                  onPress={() => {
                    setFreshness('unanalyzed');
                    resetPage();
                  }}
                />
                <FreshnessOption
                  label={t('newEvidence')}
                  selected={freshness === 'outdated'}
                  onPress={() => {
                    setFreshness('outdated');
                    resetPage();
                  }}
                />
              </View>
            </View>
            <QueryState
              loading={page.isPending}
              error={page.error}
              retry={() => void page.refetch()}>
              {page.data?.items.length === 0 && (
                <View style={styles.card}>
                  <Text style={styles.body}>
                    {hasRecordFilters ? t('noMatchingItems') : t('noItems')}
                  </Text>
                  {hasRecordFilters && !filtersOpen && (
                    <ActionButton
                      label={t('clearFilters')}
                      onPress={clearFilters}
                      secondary
                    />
                  )}
                  {!hasRecordFilters && (
                    <ActionButton
                      label={t('addItem')}
                      onPress={() => router.push('/capture')}
                    />
                  )}
                </View>
              )}
            </QueryState>
          </View>
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.code}, ${item.name ?? t('unnamed')}`}
            onPress={() => router.push(`/collection/${item.id}`)}
            style={styles.card}>
            {item.coverThumbnail && (
              <Image
                source={{ uri: item.coverThumbnail }}
                accessibilityLabel={item.name ?? item.code}
                style={{ width: '100%', height: 180, borderRadius: 8 }}
                resizeMode="contain"
              />
            )}
            <Text style={styles.heading}>{item.name ?? t('unnamed')}</Text>
            <Text style={styles.secondary}>
              {item.code} · {item.locationLabel ?? t('unknown')}
            </Text>
            <Text style={styles.body}>
              {item.analysisFreshness === 'outdated'
                ? t('newEvidence')
                : item.analysisFreshness === 'unanalyzed'
                  ? t('notAnalyzed')
                  : t('saved')}
            </Text>
            {item.pendingCheckCount > 0 && (
              <Text style={styles.secondary}>
                {item.pendingCheckCount} {t('tasks')}
              </Text>
            )}
          </Pressable>
        )}
        ListFooterComponent={
          !page.error && !page.isPending ? (
            <View style={{ gap: 12 }}>
              {cursorHistory.length > 0 && (
                <ActionButton
                  label={t('previousPage')}
                  onPress={() => {
                    setCursor(cursorHistory.at(-1) ?? null);
                    setCursorHistory((current) => current.slice(0, -1));
                  }}
                  secondary
                />
              )}
              {page.data.nextCursor && (
                <ActionButton
                  label={t('more')}
                  onPress={() => {
                    setCursorHistory((current) => [...current, cursor]);
                    setCursor(page.data.nextCursor);
                  }}
                  secondary
                />
              )}
            </View>
          ) : null
        }
      />
    </Screen>
  );
}
