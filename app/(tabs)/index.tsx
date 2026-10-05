import { Link } from "expo-router";
import { Text, View } from "react-native";

export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-xl font-bold text-success">
        Welcome to Nativewind!
      </Text>
      <Link
        href="/onboarding"
        className="mt-4 rounded bg-primary p-4 text-primary-foreground"
      >
        Go to Onboarding
      </Link>
      <Link
        href="/(auth)/sign-in"
        className="mt-4 rounded bg-primary p-4 text-primary-foreground"
      >
        Go to Sign In
      </Link>
      <Link
        href="/(auth)/sign-up"
        className="mt-4 rounded bg-primary p-4 text-primary-foreground"
      >
        Go to Sign Up
      </Link>
      <Link
        href="/subscriptions/spotify"
        className="mt-4 rounded bg-primary p-4 text-primary-foreground"
      >
        Spotify Subscription
      </Link>
      <Link
        href={{ pathname: "/subscriptions/[id]", params: { id: "claude" } }}
        className="mt-4 rounded bg-primary p-4 text-primary-foreground"
      >
        Claude Max Subscription
      </Link>
    </View>
  );
}
