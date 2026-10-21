import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton, colors, styles, theme } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import {
  gridFiles,
  isSelected,
  selectedCount,
  usedLabels,
} from '../capture-grid';

import { CaptureGridTile } from './CaptureGridTile';
import { CaptureLabelPicker } from './CaptureLabelPicker';

import type { FC } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';

export type CaptureGridStepProps = {
  kind: 'single' | 'set';
  /** record name, or the new-item label while it has none */
  recordName: string;
  recordCode: string;
  files: LocalMedia[];
  /** labels of the components the record already has */
  componentLabels: readonly string[];
  /** video stills by file ID; null when a still could not be made */
  thumbnails: Readonly<Record<string, string | null>>;
  /** another upload or save is running, so retrying waits */
  busy?: boolean;
  onToggle: (fileId: string) => void;
  onLabel: (fileId: string, componentLabel: string) => void;
  /** uploads a failed file again */
  onRetry: (fileId: string) => void;
  onAddPhoto: () => void;
  onAddVideo: () => void;
  onBack: () => void;
  onNext: () => void;
};

const layout = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: {
    minWidth: 48,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backText: { color: colors.jade, fontSize: 28 },
  summary: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 8,
  },
  name: { color: colors.jade, fontSize: 20, ...theme.font.face('sans', '700') },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
  },
  actions: { flexDirection: 'row', gap: 12 },
  action: { flex: 1 },
});

/**
 * renders the grid header: back, title, the record and the selected count
 * @param props record and count details
 * @param props.recordName record name or the new-item label
 * @param props.recordCode code identifying the record, such as AC-0001
 * @param props.count files selected for saving
 * @param props.onBack returns to the capture step
 * @returns the header block
 */
const GridHeader: FC<
  Pick<CaptureGridStepProps, 'recordName' | 'recordCode' | 'onBack'> & {
    count: number;
  }
> = ({ recordName, recordCode, count, onBack }) => {
  const { t } = useLocale();

  return (
    <>
      <View style={layout.header}>
        <Pressable
          testID="capture-grid-back"
          accessibilityRole="button"
          accessibilityLabel={t('back')}
          onPress={onBack}
          style={layout.back}>
          <Text style={layout.backText}>‹</Text>
        </Pressable>
        <Text accessibilityRole="header" style={styles.heading}>
          {t('gridTitle')}
        </Text>
      </View>
      <View style={layout.summary}>
        <View>
          <Text style={layout.name}>{recordName}</Text>
          <Text style={styles.secondary}>{recordCode}</Text>
        </View>
        <Text
          testID="capture-grid-count"
          accessibilityLiveRegion="polite"
          style={styles.secondary}>
          {t('selectedCount', { count })}
        </Text>
      </View>
    </>
  );
};

/**
 * renders the actions below the grid: add photo, add video, and next
 * @param props action handlers
 * @param props.onAddPhoto opens the camera for more photos
 * @param props.onAddVideo records a video
 * @param props.onNext continues to the description step
 * @returns the action block
 */
const GridActions: FC<
  Pick<CaptureGridStepProps, 'onAddPhoto' | 'onAddVideo' | 'onNext'>
> = ({ onAddPhoto, onAddVideo, onNext }) => {
  const { t } = useLocale();

  return (
    <>
      <View style={layout.actions}>
        <View style={layout.action}>
          <ActionButton
            testID="capture-grid-add-photo"
            label={t('addPhoto')}
            onPress={onAddPhoto}
            secondary
          />
        </View>
        <View style={layout.action}>
          <ActionButton
            testID="capture-grid-add-video"
            label={t('addVideo')}
            onPress={onAddVideo}
            secondary
          />
        </View>
      </View>
      <ActionButton
        testID="capture-grid-next"
        label={t('next')}
        onPress={onNext}
      />
    </>
  );
};

/**
 * renders the image grid (B03): the record, the selected count, two columns of tiles to keep or
 * leave out and, for a set, label by component, then actions to add photos or videos and go on
 * @param props draft files and handlers
 * @param props.kind single item or set; only a set labels components
 * @param props.files every draft file; the grid shows the object files
 * @param props.componentLabels labels of the record's existing components
 * @param props.thumbnails video stills by file ID
 * @param props.busy disables retrying while another upload runs
 * @param props.onToggle selects or deselects a file
 * @param props.onLabel gives a file a component label
 * @param props.onRetry uploads a failed file again
 * @returns the grid card with its label picker
 */
export const CaptureGridStep: FC<CaptureGridStepProps> = ({
  kind,
  files,
  componentLabels,
  thumbnails,
  busy = false,
  onToggle,
  onLabel,
  onRetry,
  ...actions
}) => {
  const { t } = useLocale();
  const [editingId, setEditingId] = useState<string | null>(null);
  const shown = gridFiles(files);
  const editing = shown.find((file) => file.id === editingId);
  const itemName = (file: LocalMedia): string =>
    t(file.kind === 'video' ? 'gridVideo' : 'gridPhoto', {
      index: shown.indexOf(file) + 1,
    });

  return (
    <View style={styles.card}>
      <GridHeader {...actions} count={selectedCount(files)} />
      <View style={layout.grid}>
        {shown.map((file, index) => (
          <CaptureGridTile
            key={file.id}
            index={index + 1}
            file={file}
            thumbnailUri={thumbnails[file.id] ?? null}
            labelled={kind === 'set'}
            selected={isSelected(file)}
            busy={busy}
            onToggle={() => onToggle(file.id)}
            onLabel={() => setEditingId(file.id)}
            onRetry={() => onRetry(file.id)}
          />
        ))}
      </View>
      <GridActions {...actions} />
      {editing && (
        <CaptureLabelPicker
          used={usedLabels(files, componentLabels)}
          item={itemName(editing)}
          current={editing.componentLabel}
          onPick={(label) => {
            onLabel(editing.id, label);
            setEditingId(null);
          }}
          onCancel={() => setEditingId(null)}
        />
      )}
    </View>
  );
};
