import { Link, useLocalSearchParams } from "expo-router";
import { Text, View } from "react-native";

export default function SubscriptionDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();

  return (
    <View>
      <Link href="/">Go Back</Link>
      <Text>Subscription Details: {id}</Text>
    </View>
  );
}
