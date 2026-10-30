import { useClerk } from "@clerk/expo";
import { Link } from "expo-router";
import { useEffect, useState, type ReactNode } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { SafeAreaView } from "@/components/safe-area-view";
import type { IconName } from "@/constants/icons";
import { useThemeColors } from "@/lib/theme";

const FEATURES: { icon: IconName; text: string }[] = [
  { icon: "wallet", text: "Every subscription and renewal in one place" },
  { icon: "analytics", text: "Dividend growth research, backed by the numbers" },
  { icon: "pie-chart", text: "Your portfolio measured against the S&P 500" },
];

/** Sign-in / sign-up page frame: brand mark, title, subtitle, form, footer. */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
  showFeatures,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
  showFeatures?: boolean;
}) {
  return (
    <SafeAreaView className="auth-screen" edges={["top", "left", "right", "bottom"]}>
      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerClassName="auth-content" keyboardShouldPersistTaps="handled">
          <View>
            <Link href="/welcome" accessibilityRole="link" accessibilityLabel="KaventaFi home">
              <Logo size={34} tagline />
            </Link>
            <Text className="auth-title" accessibilityRole="header">
              {title}
            </Text>
            <Text className="auth-subtitle">{subtitle}</Text>
          </View>
          {showFeatures ? (
            <View className="auth-features">
              {FEATURES.map((f) => (
                <View key={f.text} className="auth-feature">
                  <Icon name={f.icon} className="auth-feature-icon" />
                  <Text className="auth-feature-text">{f.text}</Text>
                </View>
              ))}
            </View>
          ) : null}
          <View className="mt-6">{children}</View>
          {footer ? <View className="auth-footer">{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  secure,
  keyboardType,
  autoComplete,
  placeholder,
  hint,
  autoCapitalize = "none",
  onSubmitEditing,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  secure?: boolean;
  keyboardType?: "email-address" | "number-pad" | "decimal-pad" | "phone-pad" | "default";
  autoComplete?: "email" | "username" | "current-password" | "new-password" | "one-time-code" | "off";
  placeholder?: string;
  hint?: string;
  autoCapitalize?: "none" | "sentences" | "words";
  onSubmitEditing?: () => void;
}) {
  const colors = useThemeColors();
  return (
    <View className="input-field">
      <Text className="input-label">{label}</Text>
      <TextInput
        className="input"
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secure}
        keyboardType={keyboardType ?? "default"}
        autoComplete={autoComplete}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        placeholder={placeholder}
        placeholderTextColor={colors.mutedForeground}
        accessibilityLabel={label}
        onSubmitEditing={onSubmitEditing}
        returnKeyType={onSubmitEditing ? "go" : undefined}
      />
      {hint ? <Text className="input-hint">{hint}</Text> : null}
    </View>
  );
}

/** `ready` false (sign-in service still loading): "Connecting…" rather than a button that ignores taps. */
export function SubmitButton({
  label,
  onPress,
  busy,
  ready = true,
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  ready?: boolean;
}) {
  const waiting = busy || !ready;
  return (
    <Pressable
      className="btn mt-1"
      style={waiting ? { opacity: 0.6 } : undefined}
      onPress={onPress}
      disabled={waiting}
      accessibilityRole="button"
      accessibilityState={{ busy: waiting, disabled: waiting }}
    >
      <Text className="btn-text">{busy ? "One moment…" : !ready ? "Connecting…" : label}</Text>
    </Pressable>
  );
}

export function FormError({ message }: { message: string | null }) {
  return message ? (
    <Text className="form-error" accessibilityLiveRegion="polite" accessibilityRole="alert">
      {message}
    </Text>
  ) : null;
}

/** Clerk's own error text when it has one. */
export function clerkMessage(e: unknown): string {
  const err = e as { errors?: { longMessage?: string; message?: string }[]; message?: string };
  return err?.errors?.[0]?.longMessage ?? err?.errors?.[0]?.message ?? err?.message ?? "Something went wrong. Try again.";
}

const SLOW_MS = 12000;

/** A note when the sign-in service hasn't loaded after a while (offline, or blocked by a content blocker). */
export function useSlowLoadNotice(loaded: boolean): string | null {
  const clerk = useClerk() as { status?: string };
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setSlow(true), SLOW_MS);
    return () => clearTimeout(t);
  }, [loaded, clerk]);
  return slow && !loaded
    ? "Still connecting to the sign-in service. Check your connection, or turn off any content blocker for this site, then reload."
    : null;
}
