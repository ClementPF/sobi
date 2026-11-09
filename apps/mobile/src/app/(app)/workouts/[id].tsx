import { useLocalSearchParams } from 'expo-router';

import { EditWorkoutScreen } from '@/features/workout/workout-editor';

export default function EditWorkoutRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <EditWorkoutScreen id={id} />;
}
