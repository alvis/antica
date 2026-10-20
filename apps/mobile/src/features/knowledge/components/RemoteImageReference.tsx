import { useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useLocale } from '../../../providers/LocaleProvider';

import { openKnowledgeSource } from '../api/knowledge';
import { useRemoteKnowledgeImage } from '../hooks/useRemoteKnowledgeImage';

import type { FC } from 'react';

import type { KnowledgeContentEnvelopeV2 } from '@antica/contracts';

/** URL metadata and a viewport signal supplied by the scrolling gallery */
export type RemoteImageReferenceProps = {
  image: KnowledgeContentEnvelopeV2['images'][number];
  caption: string;
  nearViewport?: boolean;
};
const layout = StyleSheet.create({
  image: { width: '100%', resizeMode: 'contain' },
});
const placeholderAspectRatio = 1.3333333333333333;

/**
 * displays transient image data without giving a remote URL to the native disk cache
 * @param root0 component properties
 * @param root0.image image property
 * @param root0.caption caption property
 * @param root0.nearViewport nearViewport property
 * @returns rendered knowledge content
 */
export const RemoteImageReference: FC<RemoteImageReferenceProps> = ({
  image,
  caption,
  nearViewport = false,
}) => {
  const { t } = useLocale();
  const { uri, failed, retry, markFailed } = useRemoteKnowledgeImage(
    image.imageUrl,
    nearViewport,
  );
  const [sourceFailed, setSourceFailed] = useState(false);

  return (
    <View testID={`knowledge-image-${image.id}`} style={styles.card}>
      <RemoteImageStage
        image={image}
        caption={caption}
        uri={uri}
        failed={failed}
        markFailed={markFailed}
      />
      <Text style={styles.body}>{caption}</Text>
      <Text style={styles.secondary}>{image.provider}</Text>
      <Text style={styles.secondary}>
        {image.observedRights
          ? Object.values(image.observedRights).join(' · ')
          : t('knowledgeRightsUnknown')}
      </Text>
      {failed && (
        <ActionButton
          testID={`knowledge-image-retry-${image.id}`}
          label={t('retry')}
          onPress={retry}
          secondary
        />
      )}
      <ActionButton
        testID={`knowledge-image-source-${image.id}`}
        label={t('knowledgeOpenSource')}
        onPress={() => {
          void openKnowledgeSource(image.sourcePageUrl).catch(() =>
            setSourceFailed(true),
          );
        }}
        secondary
      />
      {sourceFailed && (
        <Text accessibilityRole="alert" style={styles.error}>
          {t('knowledgeSourceUnavailable')}
        </Text>
      )}
    </View>
  );
};

/**
 * reserves image geometry through loading and failure without cropping
 * @param props transient image state and subject metadata
 * @param props.image source URL and observed metadata
 * @param props.caption image subject text
 * @param props.uri transient fetched data URL
 * @param props.failed whether the image read failed
 * @param props.markFailed handles native image decode failure
 * @returns contained image or its persistent placeholder
 */
const RemoteImageStage: FC<
  RemoteImageReferenceProps & {
    uri: string | null;
    failed: boolean;
    markFailed: () => void;
  }
> = ({ image, caption, uri, failed, markFailed }) => {
  const { t } = useLocale();
  const aspectRatio =
    image.width && image.height
      ? image.width / image.height
      : placeholderAspectRatio;

  return (
    <View style={{ aspectRatio }}>
      {uri && !failed ? (
        <Image
          source={{ uri, cache: 'reload' }}
          accessibilityLabel={t('knowledgeImageAlt', {
            subject: caption,
            provider: image.provider,
          })}
          style={[layout.image, { aspectRatio }]}
          onError={markFailed}
        />
      ) : failed ? (
        <Text testID={`knowledge-image-error-${image.id}`} style={styles.body}>
          {t('knowledgeImageUnavailable')}
        </Text>
      ) : (
        <View testID={`knowledge-image-loading-${image.id}`}>
          <ActivityIndicator />
          <Text style={styles.secondary}>{t('knowledgeImageLoading')}</Text>
        </View>
      )}
    </View>
  );
};
