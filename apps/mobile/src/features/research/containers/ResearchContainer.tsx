import { useRouter } from 'expo-router';

import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { Screen } from '../../../components/Screen';
import { useLocale } from '../../../providers/LocaleProvider';

import type { FC } from 'react';

export const ResearchContainer: FC = () => {
  const router = useRouter();
  const { t } = useLocale();

  return (
    <Screen title={t('research')}>
      <View style={styles.card}>
        <Text style={styles.heading}>{t('imageSearch')}</Text>
        <Text style={styles.body}>{t('chooseItemForSearch')}</Text>
        <ActionButton
          label={t('collection')}
          onPress={() => router.push('/collection')}
          secondary
        />
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>{t('newResearch')}</Text>
        <Text style={styles.body}>{t('researchDescription')}</Text>
        <ActionButton
          label={t('newResearch')}
          onPress={() => router.push('/research/new')}
        />
      </View>
    </Screen>
  );
};
