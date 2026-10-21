import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, theme } from '@antica/ui';

import { localizeStatus } from '../../../i18n/messages';
import { useLocale } from '../../../providers/LocaleProvider';

import { wholeRecord } from '../capture-grid';

import { CaptureFileState } from './CaptureFileState';

import type { FC } from 'react';

import type { LocalMedia } from '../../../adapters/media-upload';

export type CaptureGridTileProps = {
  /** position in the grid, counted from 1 */
  index: number;
  file: LocalMedia;
  /** still image of a video, or null when none could be made */
  thumbnailUri: string | null;
  /** whether component labels apply, as they do for a set */
  labelled: boolean;
  selected: boolean;
  /** another upload or save is running, so retrying waits */
  busy: boolean;
  onToggle: () => void;
  onLabel: () => void;
  /** uploads the file again after it failed */
  onRetry: () => void;
};

const layout = StyleSheet.create({
  tile: {
    width: '48.5%',
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  media: {
    aspectRatio: 1,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  videoIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 2,
    borderColor: colors.jade,
    alignItems: 'center',
    justifyContent: 'center',
  },
  play: {
    marginLeft: 4,
    width: 0,
    height: 0,
    borderTopWidth: 10,
    borderBottomWidth: 10,
    borderLeftWidth: 16,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.jade,
  },
  videoBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(38, 61, 53, 0.7)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  videoBadgeText: {
    color: colors.card,
    fontSize: 12,
    ...theme.font.face('sans', '600'),
  },
  select: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  check: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checked: { backgroundColor: colors.jade, borderColor: colors.jade },
  checkText: {
    color: colors.card,
    fontSize: 16,
    ...theme.font.face('sans', '700'),
  },
  strip: {
    minHeight: 48,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  stripText: {
    ...theme.font.face('sans', '400'),
    color: colors.text,
    fontSize: 16,
  },
  state: { paddingHorizontal: 12, backgroundColor: colors.card },
  stripEmpty: { color: colors.muted },
});

/**
 * renders the tile's still: the photo, the video still, or a video icon when no still exists
 * @param props media details
 * @param props.index grid position from 1
 * @param props.still image to show, or null for the video icon
 * @param props.video whether the file is a video
 * @param props.label spoken name and component of the file
 * @param props.selected whether the file will be saved
 * @returns the media area
 */
const TileMedia: FC<{
  index: number;
  still: string | null;
  video: boolean;
  label: string;
  selected: boolean;
}> = ({ index, still, video, label, selected }) => {
  const { t } = useLocale();

  return (
    <View
      testID={`capture-grid-media-${index}`}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }}
      style={layout.media}>
      {still ? (
        <Image
          testID={`capture-grid-still-${index}`}
          source={{ uri: still }}
          // decode a full-size photo at tile size to keep many photos within memory
          resizeMethod="resize"
          style={layout.image}
        />
      ) : (
        <View
          testID={`capture-grid-video-icon-${index}`}
          style={layout.videoIcon}>
          <View style={layout.play} />
        </View>
      )}
      {video && (
        <View style={layout.videoBadge}>
          <Text style={layout.videoBadgeText}>{t('video')}</Text>
        </View>
      )}
    </View>
  );
};

/**
 * renders the check mark that keeps a file for saving; an uploaded file stays checked and says so
 * @param props check mark state and handler
 * @param props.index grid position from 1
 * @param props.name spoken name of the file with its label
 * @param props.selected whether the file will be saved
 * @param props.uploaded whether the file already belongs to the record
 * @param props.onToggle selects or deselects the file
 * @returns the checkbox
 */
const SelectBox: FC<{
  index: number;
  name: string;
  selected: boolean;
  uploaded: boolean;
  onToggle: () => void;
}> = ({ index, name, selected, uploaded, onToggle }) => {
  const { t } = useLocale();

  return (
    <Pressable
      testID={`capture-grid-select-${index}`}
      accessibilityRole="checkbox"
      accessibilityLabel={t('gridSelect', { item: name })}
      accessibilityHint={uploaded ? localizeStatus('uploaded', t) : undefined}
      accessibilityState={{ checked: selected, disabled: uploaded }}
      disabled={uploaded}
      onPress={onToggle}
      style={layout.select}>
      <View style={[layout.check, selected && layout.checked]}>
        {selected && <Text style={layout.checkText}>✓</Text>}
      </View>
    </Pressable>
  );
};

/**
 * renders the strip naming a set component that opens the label picker
 * @param props strip content and handler
 * @param props.index grid position from 1
 * @param props.item spoken name of the photo or video
 * @param props.label component label shown on the strip
 * @param props.empty whether the file has no label yet
 * @param props.onLabel opens the label picker
 * @returns a button naming the component, which opens the picker
 */
const LabelStrip: FC<{
  index: number;
  item: string;
  label: string;
  empty: boolean;
  onLabel: () => void;
}> = ({ index, item, label, empty, onLabel }) => {
  const { t } = useLocale();

  return (
    <Pressable
      testID={`capture-grid-label-${index}`}
      accessibilityRole="button"
      accessibilityLabel={t('gridEditLabel', { item })}
      accessibilityValue={{ text: label }}
      onPress={onLabel}
      style={layout.strip}>
      <Text
        numberOfLines={1}
        style={[layout.stripText, empty && layout.stripEmpty]}>
        {label}
      </Text>
    </Pressable>
  );
};

/**
 * renders one grid tile (B03): the photo or video still, a check mark that keeps it for saving,
 * and, for a set, a strip naming its component that opens the label picker
 * @param props tile content and handlers
 * @param props.index grid position from 1
 * @param props.file local photo or video
 * @param props.thumbnailUri video still, or null for the video icon
 * @param props.labelled shows the component strip when true
 * @param props.selected whether the file will be saved
 * @param props.busy disables retrying while another upload runs
 * @param props.onToggle selects or deselects the file
 * @param props.onLabel opens the label picker
 * @param props.onRetry uploads the file again after it failed
 * @returns the tile with its check mark, upload state and label strip
 */
export const CaptureGridTile: FC<CaptureGridTileProps> = ({
  index,
  file,
  thumbnailUri,
  labelled,
  selected,
  busy,
  onToggle,
  onLabel,
  onRetry,
}) => {
  const { t } = useLocale();
  const video = file.kind === 'video';
  const item = t(video ? 'gridVideo' : 'gridPhoto', { index });
  const label =
    file.componentLabel === wholeRecord
      ? t('labelWholeRecord')
      : file.componentLabel || t('noLabel');
  const name = labelled ? t('gridItemLabel', { item, label }) : item;

  return (
    <View
      testID={`capture-grid-tile-${index}`}
      style={[layout.tile, !selected && { opacity: 0.55 }]}>
      <TileMedia
        index={index}
        still={video ? thumbnailUri : file.uri}
        video={video}
        label={name}
        selected={selected}
      />
      <SelectBox
        index={index}
        name={name}
        selected={selected}
        // an uploaded file already belongs to the record, so it can no longer be left out
        uploaded={file.state === 'uploaded'}
        onToggle={onToggle}
      />
      {file.state !== 'local' && (
        <View style={layout.state}>
          <CaptureFileState
            index={index}
            file={file}
            name={item}
            busy={busy}
            onRetry={onRetry}
          />
        </View>
      )}
      {labelled && (
        <LabelStrip
          index={index}
          item={item}
          label={label}
          empty={!file.componentLabel}
          onLabel={onLabel}
        />
      )}
    </View>
  );
};
