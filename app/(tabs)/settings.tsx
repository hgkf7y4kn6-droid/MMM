import { useClerk, useUser } from "@clerk/clerk-expo";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { SafeAreaView } from "@/components/safe-area-view";
import { getClerkErrorMessage } from "@/lib/clerk-error";

export default function Settings() {
  const { user } = useUser();
  const { signOut } = useClerk();
  const [error, setError] = useState<string | null>(null);

  const onSignOut = async () => {
    setError(null);
    try {
      // The root layout's route guard sends the user back to sign-in.
      await signOut();
    } catch (err) {
      setError(getClerkErrorMessage(err));
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-background p-5">
      <Text className="font-sans-extrabold text-3xl text-foreground">
        Settings
      </Text>

      <View className="settings-card">
        <Text className="settings-label">Signed in as</Text>
        <Text className="settings-value" numberOfLines={1}>
          {user?.primaryEmailAddress?.emailAddress ?? "—"}
        </Text>
      </View>

      {error && <Text className="auth-error">{error}</Text>}

      <Pressable
        onPress={onSignOut}
        accessibilityRole="button"
        className="settings-signout"
      >
        <Text className="settings-signout-text">Sign out</Text>
      </Pressable>
    </SafeAreaView>
  );
}
