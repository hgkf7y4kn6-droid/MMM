import { Stack } from "expo-router";

// Signed-out users land on sign-in first.
export const unstable_settings = {
  initialRouteName: "sign-in",
};

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  );
}
