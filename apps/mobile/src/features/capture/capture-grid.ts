import type { RecordDetail } from '@antica/contracts';

import type { LocalMedia } from '../../adapters/media-upload';
import type { PlainMessageKey } from '../../i18n/messages';

/** kind of shot the collector is taking in the in-app camera */
export type ShotType = NonNullable<LocalMedia['shotType']>;

/** shot types in the order the camera offers them, complete set first */
export const shotTypes: readonly ShotType[] = ['set', 'base', 'mark', 'detail'];

/** message naming each shot type */
export const shotTypeLabels: Readonly<Record<ShotType, PlainMessageKey>> = {
  set: 'shotSet',
  base: 'shotBase',
  mark: 'shotMark',
  detail: 'shotDetail',
};

/**
 * label of a photo or video that shows the whole record rather than one of its components; a
 * language-independent value no collector would type, never turned into a component
 */
export const wholeRecord = '@whole-record';

/**
 * tells whether a file label names a component of the record
 * @param label trimmed file label
 * @returns false for no label and for the whole record
 */
function isComponent(label: string): boolean {
  return label !== '' && label !== wholeRecord;
}

/**
 * lists the object photos and videos the grid shows, excluding receipts and other purposes
 * @param files every file of the draft
 * @returns the object files in capture order
 */
export function gridFiles(files: readonly LocalMedia[]): LocalMedia[] {
  return files.filter((file) => file.purpose === 'object');
}

/**
 * tells whether a file will be saved with the record
 * @param file draft file
 * @returns false once the collector deselected it
 */
export function isSelected(file: LocalMedia): boolean {
  return !file.excluded;
}

/**
 * counts the grid files selected for saving
 * @param files every file of the draft
 * @returns number of selected object files
 */
export function selectedCount(files: readonly LocalMedia[]): number {
  return gridFiles(files).filter(isSelected).length;
}

/**
 * selects or deselects one file without discarding it
 * @param files every file of the draft
 * @param fileId file to toggle
 * @returns the draft files with that file's selection flipped, unless it is already uploaded
 */
export function toggleSelected(
  files: readonly LocalMedia[],
  fileId: string,
): LocalMedia[] {
  // an uploaded file already belongs to the record, so it stays selected
  return files.map((file) =>
    file.id === fileId && file.state !== 'uploaded'
      ? { ...file, excluded: isSelected(file) }
      : file,
  );
}

/**
 * gives one file a component label
 * @param files every file of the draft
 * @param fileId file to label
 * @param componentLabel label to give, trimmed; empty clears it
 * @returns the draft files with that file relabelled
 */
export function labelFile(
  files: readonly LocalMedia[],
  fileId: string,
  componentLabel: string,
): LocalMedia[] {
  return files.map((file) =>
    file.id === fileId
      ? { ...file, componentLabel: componentLabel.trim() }
      : file,
  );
}

/**
 * collects the component labels a picker offers besides the whole record: the record's existing
 * components, then labels already given in this draft; shot types are views, never offered
 * @param files every file of the draft
 * @param componentLabels labels of the record's existing components
 * @returns distinct component labels in the order they were first used
 */
export function usedLabels(
  files: readonly LocalMedia[],
  componentLabels: readonly string[],
): string[] {
  return [
    ...new Set(
      [
        ...componentLabels,
        ...gridFiles(files).map((file) => file.componentLabel),
      ]
        .map((label) => label.trim())
        .filter(isComponent),
    ),
  ];
}

/**
 * collects the components the selected files name, the labels the collector picked or typed
 * @param files every file of the draft
 * @returns distinct component labels of the files that will be saved
 */
export function componentLabelsOf(files: readonly LocalMedia[]): string[] {
  return [
    ...new Set(
      files
        .filter(isSelected)
        .map((file) => file.componentLabel.trim())
        .filter(isComponent),
    ),
  ];
}

/** how the camera and grid name the draft record */
export interface RecordSummary {
  /** record name, or the new-item label while it has none */
  name: string;
  /** record code, empty before the draft exists */
  code: string;
  /** labels of the record's existing components */
  componentLabels: string[];
}

/**
 * names the draft record for the camera chip and the grid header
 * @param record draft record, null before it is created
 * @param newItem localized label of a record without a name
 * @returns the record's display name, code and component labels
 */
export function summarizeRecord(
  record: RecordDetail | null,
  newItem: string,
): RecordSummary {
  return {
    name: record?.name ?? newItem,
    code: record?.code ?? '',
    componentLabels:
      record?.components.map((component) => component.label) ?? [],
  };
}
