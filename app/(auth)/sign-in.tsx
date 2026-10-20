import { useSignIn } from "@clerk/clerk-expo";
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

export default function SignIn() {
  const { isLoaded, signIn, setActive } = useSignIn();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  // Clerk can ask for an emailed code, e.g. when signing in on a new device.
  const [needsEmailCode, setNeedsEmailCode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSignIn = async () => {
    if (!isLoaded) return;
    setError(null);
    setLoading(true);
    try {
      const result = await signIn.create({
        identifier: email.trim(),
        password,
      });

      if (result.status === "complete") {
        // The root layout's route guard moves the user into the app.
        await setActive({ session: result.createdSessionId });
      } else if (
        result.status === "needs_second_factor" &&
        result.supportedSecondFactors?.some((f) => f.strategy === "email_code")
      ) {
        await signIn.prepareSecondFactor({ strategy: "email_code" });
        setNeedsEmailCode(true);
      } else {
        setError("This account needs a sign-in method the app doesn't support yet.");
      }
    } catch (err) {
      setError(getClerkErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const onVerifyCode = async () => {
    if (!isLoaded) return;
    setError(null);
    setLoading(true);
    try {
      const result = await signIn.attemptSecondFactor({
        strategy: "email_code",
        code: code.trim(),
      });
      if (result.status === "complete") {
        await setActive({ session: result.createdSessionId });
      } else {
        setError("We couldn't verify that code. Please try again.");
      }
    } catch (err) {
      setError(getClerkErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  if (needsEmailCode) {
    return (
      <AuthScreen
        title="Confirm it's you"
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
          label="Verify and sign in"
          onPress={onVerifyCode}
          loading={loading}
          disabled={code.trim().length < 6}
        />
        <AuthButton
          label="Use a different account"
          variant="ghost"
          onPress={() => {
            setNeedsEmailCode(false);
            setCode("");
            setError(null);
          }}
        />
      </AuthScreen>
    );
  }

  return (
    <AuthScreen
      title="Welcome back"
      subtitle="Sign in to see your money at a glance."
      footer={
        <Text className="auth-footer-text">
          New to MMM?{" "}
          <Link href="/sign-up" replace className="auth-link">
            Create an account
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
        placeholder="Your password"
        secureTextEntry
        textContentType="password"
        autoComplete="password"
      />
      <AuthError message={error} />
      <AuthButton
        label="Sign in"
        onPress={onSignIn}
        loading={loading}
        disabled={!email.trim() || !password}
      />
    </AuthScreen>
  );
}
