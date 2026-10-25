import { Stack } from "expo-router";

// Signed out, this group is the first available screen, so it opens on sign-in.
export const unstable_settings = { initialRouteName: "sign-in" };

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="sign-in" />
      <Stack.Screen name="sign-up" />
    </Stack>
  );
}
