import { useEffect } from 'react';
import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { colors } from '../../constants/theme';

export default function AddTab() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/add-loan');
  }, [router]);
  return <View style={{ flex: 1, backgroundColor: colors.bg.primary }} />;
}
