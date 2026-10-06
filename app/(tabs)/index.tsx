import { Text } from "react-native";

import { SafeAreaView } from "@/components/safe-area-view";

export default function Index() {
  return (
    <SafeAreaView className="flex-1 bg-background p-5">
      <Text className="font-sans-extrabold text-5xl text-primary">Home</Text>
    </SafeAreaView>
  );
}
