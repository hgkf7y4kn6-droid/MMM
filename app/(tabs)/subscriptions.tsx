import { Text } from "react-native";

import { SafeAreaView } from "@/components/safe-area-view";

export default function Subscriptions() {
  return (
    <SafeAreaView className="flex-1 bg-background p-5">
      <Text className="font-sans text-foreground">Subscriptions</Text>
    </SafeAreaView>
  );
}
