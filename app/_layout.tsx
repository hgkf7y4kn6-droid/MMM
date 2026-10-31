import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { useFonts } from "expo-font";
import { DarkTheme, DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { router, SplashScreen, Stack, type Href } from "expo-router";
import Head from "expo-router/head";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, Platform, useColorScheme, View } from "react-native";

import { Logo } from "@/components/logo";
import { CLERK_PUBLISHABLE_KEY } from "@/constants/config";
import { colors } from "@/constants/theme";
import { EntitlementsProvider } from "@/lib/entitlements";
import { SessionProvider } from "@/lib/session";
import { SubscriptionsProvider } from "@/lib/subscriptions";

import "@/global.css";

// Keep the splash screen up until the fonts below have loaded.
SplashScreen.preventAutoHideAsync();

// Navigation chrome (the background behind screens during transitions) in the
// app's palette, so nothing flashes white in dark mode.
const navTheme = (dark: boolean) => {
  const base = dark ? DarkTheme : DefaultTheme;
  const c = colors[dark ? "dark" : "light"];
  return {
    ...base,
    colors: { ...base.colors, background: c.background, card: c.card, text: c.foreground, border: c.border, primary: c.primary },
  };
};

/**
 * Signed out, only the sign-in group and the disclosures are reachable; every
 * other screen redirects to sign-in. Signing in or out flips the guards and
 * the navigator moves to the first screen that's available.
 */
function Routes() {
  const { isLoaded, isSignedIn } = useAuth();
  const dark = useColorScheme() === "dark";

  // public/404.html sends deep links that the host couldn't serve to "/" with the
  // wanted path saved; go there once the session is known so the guards apply.
  useEffect(() => {
    if (Platform.OS !== "web" || !isLoaded) return;
    try {
      const to = sessionStorage.getItem("kfi-redirect");
      if (!to) return;
      sessionStorage.removeItem("kfi-redirect");
      if (to !== "/") router.replace(to as Href);
    } catch {}
  }, [isLoaded]);

  if (!isLoaded) {
    return (
      <View className="auth-gate">
        <Logo size={44} tagline />
        <ActivityIndicator className="mt-6" color={colors[dark ? "dark" : "light"].primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Protected guard={!!isSignedIn}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="subscriptions/[id]" options={{ presentation: "modal" }} />
        <Stack.Screen name="portfolio" />
        <Stack.Screen name="pro" />
        <Stack.Screen name="stocks/[symbol]" />
        <Stack.Screen name="imports/index" />
        <Stack.Screen name="imports/[id]" />
        <Stack.Screen name="holdings/index" />
        <Stack.Screen name="holdings/lot" options={{ presentation: "modal" }} />
        <Stack.Screen name="holdings/dividend" options={{ presentation: "modal" }} />
      </Stack.Protected>
      <Stack.Protected guard={!isSignedIn}>
        <Stack.Screen name="(auth)" />
      </Stack.Protected>
      <Stack.Screen name="disclosures" />
    </Stack>
  );
}

export default function RootLayout() {
  const dark = useColorScheme() === "dark";
  const [fontsLoaded, fontError] = useFonts({
    "sans-regular": require("../assets/fonts/PlusJakartaSans-Regular.ttf"),
    "sans-bold": require("../assets/fonts/PlusJakartaSans-Bold.ttf"),
    "sans-medium": require("../assets/fonts/PlusJakartaSans-Medium.ttf"),
    "sans-semibold": require("../assets/fonts/PlusJakartaSans-SemiBold.ttf"),
    "sans-extrabold": require("../assets/fonts/PlusJakartaSans-ExtraBold.ttf"),
    "sans-light": require("../assets/fonts/PlusJakartaSans-Light.ttf"),
    "brand-extrabold": require("../assets/fonts/Nunito_800ExtraBold.ttf"),
    "brand-black": require("../assets/fonts/Nunito_900Black.ttf"),
    "display-semibold": require("../assets/fonts/Fraunces_600SemiBold.ttf"),
    "display-bold": require("../assets/fonts/Fraunces_700Bold.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  // A font that fails to load falls back to the system font rather than a blank app.
  if (!fontsLoaded && !fontError) return null;

  return (
    <ClerkProvider publishableKey={CLERK_PUBLISHABLE_KEY} tokenCache={Platform.OS === "web" ? undefined : tokenCache}>
      <SessionProvider>
        <EntitlementsProvider>
          <SubscriptionsProvider>
            <ThemeProvider value={navTheme(dark)}>
              <Head>
                {/* Distinct icon URLs so browsers drop a cached old favicon; the apple icon and manifest cover iOS and installs. */}
                <link rel="icon" type="image/png" sizes="32x32" href="/icon-32.png" />
                <link rel="icon" type="image/png" sizes="16x16" href="/icon-16.png" />
                <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
                <link rel="manifest" href="/manifest.webmanifest" />
              </Head>
              <StatusBar style={dark ? "light" : "dark"} />
              <Routes />
            </ThemeProvider>
          </SubscriptionsProvider>
        </EntitlementsProvider>
      </SessionProvider>
    </ClerkProvider>
  );
}
