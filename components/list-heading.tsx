import { Text, TouchableOpacity, View } from "react-native";

export default function ListHeading({ title, onPress }: ListHeadingProps) {
  return (
    <View className="list-head">
      <Text className="list-title">{title}</Text>
      {onPress && (
        <TouchableOpacity
          className="list-action"
          onPress={onPress}
          accessibilityRole="button"
        >
          <Text className="list-action-text">View all</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
