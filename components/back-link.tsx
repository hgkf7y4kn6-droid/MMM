import { router } from "expo-router";
import { Pressable, Text } from "react-native";

import { Icon } from "@/components/icon";
import { icons } from "@/constants/icons";

export default function BackLink({ label = "Back" }: { label?: string }) {
  return (
    <Pressable
      className="back-link"
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icons.back} className="text-base text-primary" />
      <Text className="back-link-text">{label}</Text>
    </Pressable>
  );
}
