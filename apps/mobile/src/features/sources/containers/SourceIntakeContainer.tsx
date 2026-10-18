import { randomUUID } from 'expo-crypto';

import { File } from 'expo-file-system';

import { launchImageLibraryAsync } from 'expo-image-picker';

import { useRouter } from 'expo-router';

import { useState } from 'react';

import { Text, View, useWindowDimensions } from 'react-native';

import { sourceAcceptedSchema, sourceCommandSchema } from '@antica/contracts';
import { ActionButton, TextField, styles } from '@antica/ui';

import { uploadMedia } from '../../../adapters/media-upload';
import { Screen } from '../../../components/Screen';

import { localizeStatus } from '../../../i18n/messages';
import { useAuth } from '../../../providers/AuthProvider';
import { useLocale } from '../../../providers/LocaleProvider';

import { SourcePagePreview } from '../components/SourcePagePreview';

import type { FC } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';

interface SourceFile extends LocalMedia {
  width: number;
  height: number;
  printedPageLabel: string;
  presentation: {
    rotationQuarterTurns: 0 | 1 | 2 | 3;
    crop: {
      kind: 'rect';
      x: number;
      y: number;
      width: number;
      height: number;
    } | null;
  };
}

export const SourceIntakeContainer: FC = () => {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { api } = useAuth();
  const { t } = useLocale();
  const [intakeKey] = useState(randomUUID);
  const [kind, setKind] = useState<'book_pdf' | 'book_pages'>('book_pages');
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [authorUnknown, setAuthorUnknown] = useState(false);
  const [edition, setEdition] = useState('');
  const [publisher, setPublisher] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const addPdf = async (): Promise<void> => {
    try {
      const selection = await File.pickFileAsync({
        mimeTypes: 'application/pdf',
      });
      if (selection.canceled) {
        return;
      }
      const file = selection.result;
      setKind('book_pdf');
      setFiles([
        {
          id: randomUUID(),
          uri: file.uri,
          name: file.name,
          mimeType: 'application/pdf',
          kind: 'document',
          purpose: 'book_file',
          componentLabel: '',
          state: 'local',
          assetId: null,
          width: 0,
          height: 0,
          printedPageLabel: '',
          presentation: { rotationQuarterTurns: 0, crop: null },
        },
      ]);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const addPages = async (): Promise<void> => {
    try {
      const selection = await launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        quality: 1,
      });
      if (selection.canceled) {
        return;
      }
      setKind('book_pages');
      setFiles((current) => [
        ...current.filter((file) => file.purpose === 'book_page'),
        ...selection.assets.map((asset) => ({
          id: randomUUID(),
          uri: asset.uri,
          name: asset.fileName ?? `page-${Date.now()}.jpg`,
          mimeType: asset.mimeType ?? 'image/jpeg',
          kind: 'photo' as const,
          purpose: 'book_page' as const,
          componentLabel: '',
          state: 'local' as const,
          assetId: null,
          width: asset.width,
          height: asset.height,
          printedPageLabel: '',
          presentation: { rotationQuarterTurns: 0 as const, crop: null },
        })),
      ]);
    } catch (cause) {
      setError((cause as Error).message);
    }
  };

  const updateFile = (id: string, change: Partial<SourceFile>): void =>
    setFiles((current) =>
      current.map((file) => (file.id === id ? { ...file, ...change } : file)),
    );
  const moveFile = (index: number, direction: -1 | 1): void => {
    // the up button is disabled on the first file and the down button on the last
    const target = index + direction;
    const next = [...files];
    [next[index], next[target]] = [next[target], next[index]];
    setFiles(next);
  };

  const save = async (): Promise<void> => {
    // the save button is disabled while busy, untitled, or without files
    setBusy(true);
    setError('');
    try {
      const ready: SourceFile[] = [];
      for (const file of files) {
        if (file.assetId) {
          ready.push(file);
          continue;
        }
        updateFile(file.id, { state: 'uploading' });
        try {
          const assetId = await uploadMedia(
            api,
            file,
            { kind: 'source_intake', id: intakeKey },
            [],
          );
          const uploaded = { ...file, assetId, state: 'uploaded' as const };
          ready.push(uploaded);
          updateFile(file.id, uploaded);
        } catch (cause) {
          updateFile(file.id, { state: 'failed' });
          setError(`${file.name}: ${(cause as Error).message}`);

          return;
        }
      }
      const metadata = {
        title: title.trim(),
        contributors:
          authorUnknown || !author.trim()
            ? []
            : [
                {
                  nameAsPrinted: author.trim(),
                  role: 'author' as const,
                  attribution: 'collector_entered' as const,
                },
              ],
        authorStatus:
          authorUnknown || !author.trim()
            ? ('unknown' as const)
            : ('named' as const),
        editionStatement: edition.trim() || null,
        publisher: publisher.trim() || null,
        publicationDateAsPrinted: null,
        isbn: null,
        languages: ['zh-Hant'],
        canonicalUrl: null,
        access: 'stored_copy' as const,
        rightsStatement: null,
        attributionText: null,
      };
      const request = sourceCommandSchema.parse({
        requestKey: randomUUID(),
        mode: 'register',
        registration: {
          intakeKey,
          kind,
          metadata,
          assets: ready.map((file, order) => ({
            assetId: file.assetId,
            order,
            printedPageLabel: file.printedPageLabel || null,
            presentation: kind === 'book_pages' ? file.presentation : undefined,
          })),
          existingSourceId: null,
          expectedRevision: null,
        },
      });
      const accepted = await api.post('/v1/sources', sourceAcceptedSchema, {
        body: request,
        idempotencyKey: request.requestKey,
      });
      router.replace(`/sources/${accepted.sourceId}`);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const imageWidth = width - 64;

  return (
    <Screen title={t('importBook')}>
      <View style={styles.card}>
        <ActionButton label="PDF" onPress={() => void addPdf()} secondary />
        <ActionButton
          label={t('photo')}
          onPress={() => void addPages()}
          secondary
        />
        <Text style={styles.secondary}>
          {kind === 'book_pdf' ? 'PDF' : t('pageOrder')}
        </Text>
      </View>
      {files.map((file, index) => (
        <View key={file.id} style={styles.card}>
          <Text style={styles.heading}>
            {index + 1}. {file.name}
          </Text>
          {kind === 'book_pages' && (
            <>
              <SourcePagePreview
                uri={file.uri}
                name={file.name}
                width={file.width}
                height={file.height}
                displayWidth={imageWidth}
                rotationQuarterTurns={file.presentation.rotationQuarterTurns}
                crop={file.presentation.crop}
                onCrop={(ratioX, ratioY) =>
                  updateFile(file.id, {
                    presentation: {
                      ...file.presentation,
                      crop: {
                        kind: 'rect',
                        x: Math.min(Math.max(ratioX - 0.25, 0), 0.5),
                        y: Math.min(Math.max(ratioY - 0.25, 0), 0.5),
                        width: 0.5,
                        height: 0.5,
                      },
                    },
                  })
                }
              />
              <Text style={styles.secondary}>
                {file.presentation.crop
                  ? t('selectedRegion', {
                      crop: JSON.stringify(file.presentation.crop),
                    })
                  : t('fullImage')}
              </Text>
              <View style={styles.row}>
                <ActionButton
                  label={t('rotate')}
                  onPress={() =>
                    updateFile(file.id, {
                      presentation: {
                        ...file.presentation,
                        rotationQuarterTurns: ((file.presentation
                          .rotationQuarterTurns +
                          1) %
                          4) as 0 | 1 | 2 | 3,
                      },
                    })
                  }
                  secondary
                />
                <ActionButton
                  label={t('fullImage')}
                  onPress={() =>
                    updateFile(file.id, {
                      presentation: { ...file.presentation, crop: null },
                    })
                  }
                  secondary
                />
                <ActionButton
                  label="↑"
                  onPress={() => moveFile(index, -1)}
                  disabled={index === 0}
                  secondary
                />
                <ActionButton
                  label="↓"
                  onPress={() => moveFile(index, 1)}
                  disabled={index === files.length - 1}
                  secondary
                />
              </View>
              <TextField
                label={t('printedPage')}
                value={file.printedPageLabel}
                onChangeText={(value) =>
                  updateFile(file.id, { printedPageLabel: value })
                }
              />
            </>
          )}
          <Text style={styles.secondary}>{localizeStatus(file.state, t)}</Text>
        </View>
      ))}
      <View style={styles.card}>
        <TextField
          label={t('bookTitle')}
          value={title}
          onChangeText={setTitle}
        />
        <ActionButton
          label={t('unknownAuthor')}
          onPress={() => setAuthorUnknown((value) => !value)}
          secondary={!authorUnknown}
        />
        {!authorUnknown && (
          <TextField
            label={t('author')}
            value={author}
            onChangeText={setAuthor}
          />
        )}
        <TextField
          label={t('edition')}
          value={edition}
          onChangeText={setEdition}
        />
        <TextField
          label={t('publisher')}
          value={publisher}
          onChangeText={setPublisher}
        />
        <ActionButton
          label={busy ? t('processing') : t('save')}
          onPress={() => void save()}
          disabled={busy || !title.trim() || files.length === 0}
        />
      </View>
      {Boolean(error) && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
    </Screen>
  );
};
