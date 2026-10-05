import { Text } from "react-native";

import { SafeAreaView } from "@/components/safe-area-view";

export default function Insights() {
  return (
    <SafeAreaView className="flex-1 bg-background p-5">
      <Text className="text-foreground">Insights</Text>
    </SafeAreaView>
  );
}
