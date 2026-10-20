import { clsx } from "clsx";
import type { ReactNode } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  useColorScheme,
  View,
  type TextInputProps,
} from "react-native";

import { SafeAreaView } from "@/components/safe-area-view";
import { colors } from "@/constants/theme";

type AuthScreenProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
};

/** Shared shell for the sign-in / sign-up screens. */
export function AuthScreen({ title, subtitle, children, footer }: AuthScreenProps) {
  return (
    <SafeAreaView className="flex-1 bg-background">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerClassName="auth-scroll"
          keyboardShouldPersistTaps="handled"
        >
          <View className="auth-brand">
            <Text className="auth-brand-mark">MMM</Text>
            <Text className="auth-brand-name">Mindful Money Management</Text>
          </View>

          <Text className="auth-title">{title}</Text>
          <Text className="auth-subtitle">{subtitle}</Text>

          <View className="auth-form">{children}</View>

          {footer && <View className="auth-footer">{footer}</View>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type AuthFieldProps = TextInputProps & { label: string };

export function AuthField({ label, ...inputProps }: AuthFieldProps) {
  const theme = colors[useColorScheme() === "dark" ? "dark" : "light"];

  return (
    <View className="auth-field">
      <Text className="auth-label">{label}</Text>
      <TextInput
        className="auth-input"
        placeholderTextColor={theme.mutedForeground}
        autoCorrect={false}
        {...inputProps}
      />
    </View>
  );
}

type AuthButtonProps = {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "ghost";
};

export function AuthButton({
  label,
  onPress,
  loading,
  disabled,
  variant = "primary",
}: AuthButtonProps) {
  const inactive = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      className={clsx(
        variant === "primary" ? "auth-button" : "auth-button-ghost",
        inactive && "opacity-50",
      )}
    >
      {loading ? (
        <ActivityIndicator />
      ) : (
        <Text
          className={
            variant === "primary" ? "auth-button-text" : "auth-button-ghost-text"
          }
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}

export function AuthError({ message }: { message: string | null }) {
  if (!message) return null;
  return <Text className="auth-error">{message}</Text>;
}
