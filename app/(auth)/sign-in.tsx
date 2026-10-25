import { useSignIn } from "@clerk/expo/legacy";
import { Link } from "expo-router";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";

import { AuthShell, clerkMessage, Field, FormError, SubmitButton, useSlowLoadNotice } from "@/components/auth-shell";

type Step = "password" | "first_code" | "second_code";
type Factor = { strategy: string; emailAddressId?: string; phoneNumberId?: string };

/**
 * Sign in with email (or username) and password, or a one-time code by email
 * (also the way back in after a forgotten password). Handles Clerk's
 * new-device check and second factors with a code too. Once signed in, the
 * root layout's guards open the app.
 */
export default function SignIn() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const slowNotice = useSlowLoadNotice(isLoaded);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("password");
  const [codeStrategy, setCodeStrategy] = useState<"email_code" | "phone_code">("email_code");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const finish = (sessionId: string | null) => setActive!({ session: sessionId });

  const pick = (factors: Factor[] | null | undefined) => {
    const list = factors ?? [];
    return list.find((f) => f.strategy === "email_code") ?? list.find((f) => f.strategy === "phone_code");
  };

  const sendFirstCode = async (factors: Factor[] | null | undefined) => {
    const f = pick(factors);
    if (!f) throw new Error("This account can't sign in with a code. Use your password.");
    await signIn!.prepareFirstFactor(
      f.strategy === "email_code"
        ? { strategy: "email_code", emailAddressId: f.emailAddressId! }
        : { strategy: "phone_code", phoneNumberId: f.phoneNumberId! },
    );
    setCodeStrategy(f.strategy as "email_code" | "phone_code");
    setCode("");
    setStep("first_code");
  };

  // After the first factor: a second factor, or Clerk's new-device check.
  const afterFirst = async (res: {
    status: string | null;
    supportedFirstFactors?: Factor[] | null;
    supportedSecondFactors?: Factor[] | null;
  }) => {
    if (res.status === "needs_first_factor") return sendFirstCode(res.supportedFirstFactors);
    if (res.status === "needs_second_factor" || res.status === "needs_client_trust") {
      const f = pick(res.supportedSecondFactors) ?? { strategy: "email_code" };
      await signIn!.prepareSecondFactor(
        f.strategy === "phone_code"
          ? { strategy: "phone_code", phoneNumberId: f.phoneNumberId }
          : { strategy: "email_code", emailAddressId: f.emailAddressId },
      );
      setCodeStrategy(f.strategy === "phone_code" ? "phone_code" : "email_code");
      setCode("");
      setStep("second_code");
      return;
    }
    setError("Your account needs a sign-in step this app doesn't support yet. Try signing in with a code.");
  };

  const run = async (fn: () => Promise<unknown>) => {
    if (!isLoaded || busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const errCode = (e as { errors?: { code?: string }[] })?.errors?.[0]?.code;
      if (errCode !== "session_exists") setError(clerkMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = () =>
    run(async () => {
      if (step === "first_code") {
        const res = await signIn!.attemptFirstFactor({ strategy: codeStrategy, code: code.trim() });
        if (res.status === "complete") return finish(res.createdSessionId);
        return afterFirst(res);
      }
      if (step === "second_code") {
        const res = await signIn!.attemptSecondFactor({ strategy: codeStrategy, code: code.trim() });
        if (res.status === "complete") return finish(res.createdSessionId);
        return setError("That code didn't work. Check it and try again.");
      }
      if (!email.trim()) return setError("Enter your email or username.");
      // No password (accounts can be passwordless): email a one-time code instead.
      if (!password) {
        const first = await signIn!.create({ identifier: email.trim() });
        return sendFirstCode(first.supportedFirstFactors as Factor[] | null);
      }
      const res = await signIn!.create({ identifier: email.trim(), password });
      if (res.status === "complete") return finish(res.createdSessionId);
      return afterFirst(res);
    });

  const emailCode = () =>
    run(async () => {
      if (!email.trim()) return setError("Enter your email or username first.");
      const res = await signIn!.create({ identifier: email.trim() });
      await sendFirstCode(res.supportedFirstFactors as Factor[] | null);
    });

  const back = () => {
    setStep("password");
    setCode("");
    setError(null);
  };

  const coding = step !== "password";
  const where = codeStrategy === "email_code" ? "email" : "phone";
  return (
    <AuthShell
      title={coding ? `Check your ${where}` : "Welcome back"}
      subtitle={
        coding
          ? `Enter the code we sent to your ${where}.`
          : "Sign in to see your subscriptions, research and portfolio. No password? Leave it blank and we'll email you a code."
      }
      showFeatures={!coding}
      footer={
        coding ? null : (
          <View className="w-full items-center">
            <Text className="mb-2 font-sans-medium text-sm text-muted-foreground">New to Mindful Money?</Text>
            <Link href="/sign-up" replace asChild>
              <Pressable className="btn-outline w-full" accessibilityRole="link">
                <Text className="btn-outline-text">Create a free account</Text>
              </Pressable>
            </Link>
            <Text className="auth-fineprint">
              One account works across Riches Digital Ventures apps, including Riches Analytics.
            </Text>
          </View>
        )
      }
    >
      <FormError message={error ?? slowNotice} />
      {coding ? (
        <Field
          label="Verification code"
          value={code}
          onChangeText={setCode}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          onSubmitEditing={submit}
        />
      ) : (
        <>
          <Field
            label="Email or username"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            placeholder="you@example.com"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secure
            autoComplete="current-password"
            hint="Optional — leave blank to get a sign-in code by email."
            onSubmitEditing={submit}
          />
        </>
      )}
      <SubmitButton
        label={coding ? "Verify" : password ? "Sign in" : "Email me a code"}
        onPress={submit}
        busy={busy}
        ready={isLoaded}
      />
      <Pressable
        className="mt-4 min-h-11 items-center justify-center"
        onPress={coding ? back : emailCode}
        accessibilityRole="button"
        disabled={busy || !isLoaded}
      >
        <Text className="link-text text-sm">
          {coding ? "Use a different email or password" : "Forgot your password? Email me a code"}
        </Text>
      </Pressable>
    </AuthShell>
  );
}
