import { Text } from "react-native";

import { SafeAreaView } from "@/components/safe-area-view";

export default function Settings() {
  return (
    <SafeAreaView className="flex-1 bg-background p-5">
      <Text className="text-foreground">Settings</Text>
    </SafeAreaView>
  );
}
