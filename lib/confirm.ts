import { Alert, Platform } from "react-native";

/**
 * Ask before a destructive action. React Native's Alert has no buttons on
 * the web (it does nothing there), so the browser's own dialog is used.
 */
export function confirm(title: string, message: string, actionLabel: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) =>
    Alert.alert(
      title,
      message,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: actionLabel, style: "destructive", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    ),
  );
}
