import { useRouter } from 'expo-router';

import { Text, View } from 'react-native';

import { ActionButton, styles } from '@antica/ui';

import { useAuth } from '../../auth';
import { Screen } from '../../components/Screen';
import { useLocale } from '../../locale';

export default function SettingsRoute() {
  const router = useRouter();
  const { phone, signOut } = useAuth();
  const { locale, setLocale, t } = useLocale();

  return (
    <Screen title={t('settings')}>
      <View style={styles.card}>
        <Text style={styles.heading}>{t('language')}</Text>
        <ActionButton
          label="English"
          onPress={() => void setLocale('en')}
          secondary={locale !== 'en'}
        />
        <ActionButton
          label="繁體中文"
          onPress={() => void setLocale('zh-Hant')}
          secondary={locale !== 'zh-Hant'}
        />
      </View>
      <View style={styles.card}>
        <Text style={styles.heading}>{t('session')}</Text>
        <Text style={styles.body}>
          {phone?.replace(/.(?=.{4})/g, '•') ?? t('unknown')}
        </Text>
        <ActionButton
          label={t('signOut')}
          onPress={() => void signOut().then(() => router.replace('/login'))}
          secondary
        />
      </View>
    </Screen>
  );
}
