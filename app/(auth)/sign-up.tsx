import { useSignUp } from "@clerk/clerk-expo";
import { Link } from "expo-router";
import { useState } from "react";
import { Text } from "react-native";

import {
  AuthButton,
  AuthError,
  AuthField,
  AuthScreen,
} from "@/components/auth/auth-form";
import { getClerkErrorMessage } from "@/lib/clerk-error";

export default function SignUp() {
  const { isLoaded, signUp, setActive } = useSignUp();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [pendingVerification, setPendingVerification] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onCreateAccount = async () => {
    if (!isLoaded) return;
    setError(null);
    setLoading(true);
    try {
      await signUp.create({ emailAddress: email.trim(), password });
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
      setPendingVerification(true);
    } catch (err) {
      setError(getClerkErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const onVerify = async () => {
    if (!isLoaded) return;
    setError(null);
    setLoading(true);
    try {
      const result = await signUp.attemptEmailAddressVerification({
        code: code.trim(),
      });
      if (result.status === "complete") {
        // The root layout's route guard moves the user into the app.
        await setActive({ session: result.createdSessionId });
      } else {
        setError("We couldn't finish creating your account. Please try again.");
      }
    } catch (err) {
      setError(getClerkErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const onResend = async () => {
    if (!isLoaded) return;
    setError(null);
    try {
      await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    } catch (err) {
      setError(getClerkErrorMessage(err));
    }
  };

  if (pendingVerification) {
    return (
      <AuthScreen
        title="Check your email"
        subtitle={`Enter the 6-digit code we sent to ${email.trim()}.`}
      >
        <AuthField
          label="Verification code"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
        />
        <AuthError message={error} />
        <AuthButton
          label="Verify and continue"
          onPress={onVerify}
          loading={loading}
          disabled={code.trim().length < 6}
        />
        <AuthButton label="Resend code" onPress={onResend} variant="ghost" />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Create your account"
      subtitle="Track income, spending, subscriptions and investments in one place."
      footer={
        <Text className="auth-footer-text">
          Already have an account?{" "}
          <Link href="/sign-in" replace className="auth-link">
            Sign in
          </Link>
        </Text>
      }
    >
      <AuthField
        label="Email"
        value={email}
        onChangeText={setEmail}
        placeholder="you@example.com"
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="emailAddress"
        autoComplete="email"
      />
      <AuthField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="At least 8 characters"
        secureTextEntry
        textContentType="newPassword"
        autoComplete="new-password"
      />
      <AuthError message={error} />
      <AuthButton
        label="Create account"
        onPress={onCreateAccount}
        loading={loading}
        disabled={!email.trim() || !password}
      />
    </AuthScreen>
  );
}
