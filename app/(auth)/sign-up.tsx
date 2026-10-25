import { useSignUp } from "@clerk/expo/legacy";
import { Link } from "expo-router";
import { useState } from "react";
import { Platform, Text, View } from "react-native";

import { AuthShell, clerkMessage, Field, FormError, SubmitButton, useSlowLoadNotice } from "@/components/auth-shell";

type Step = "details" | "more" | "email_code" | "phone_code";
type Extra = "first_name" | "last_name" | "password" | "phone_number";
type SignUpResult = { status: string | null; createdSessionId: string | null; unverifiedFields: string[]; missingFields: string[] };

const EXTRA_LABEL: Record<Extra, string> = {
  first_name: "First name",
  last_name: "Last name",
  password: "Password",
  phone_number: "Mobile number",
};
const EXTRAS = Object.keys(EXTRA_LABEL) as Extra[];

/**
 * Create an account in as few steps as the sign-in service allows: email and
 * username, then the code emailed to verify it. Anything else the service
 * still requires (a password, a name, a phone number) is asked for afterwards,
 * only if it's required.
 */
export default function SignUp() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const slowNotice = useSlowLoadNotice(isLoaded);
  const [form, setForm] = useState({ email: "", username: "", first_name: "", last_name: "", password: "", phone_number: "" });
  const [missing, setMissing] = useState<Extra[]>([]);
  const [code, setCode] = useState("");
  const [step, setStep] = useState<Step>("details");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const phone = () => {
    const p = form.phone_number.trim();
    return p ? (p.startsWith("+") ? p : `+1${p.replace(/\D/g, "")}`) : undefined;
  };

  // After each step: finish, verify the email, ask for what's still required, or verify the phone.
  const advance = async (res: SignUpResult) => {
    setCode("");
    if (res.status === "complete") return setActive!({ session: res.createdSessionId });
    if (res.unverifiedFields.includes("email_address")) {
      await signUp!.prepareEmailAddressVerification({ strategy: "email_code" });
      return setStep("email_code");
    }
    const extras = EXTRAS.filter((f) => res.missingFields.includes(f));
    if (extras.length) {
      setMissing(extras);
      return setStep("more");
    }
    if (res.unverifiedFields.includes("phone_number")) {
      await signUp!.preparePhoneNumberVerification({ strategy: "phone_code" });
      return setStep("phone_code");
    }
    setError("Your account needs a step this app doesn't support yet. Please try again later.");
  };

  const submit = async () => {
    if (!isLoaded || busy) return;
    setError(null);
    if (step === "details" && (!form.email.trim() || !form.username.trim())) {
      return setError("Enter your email and pick a username.");
    }
    setBusy(true);
    try {
      if (step === "details") {
        await advance(
          (await signUp!.create({
            emailAddress: form.email.trim(),
            username: form.username.trim(),
            unsafeMetadata: { signed_up_from: "mindful-money" },
          })) as SignUpResult,
        );
      } else if (step === "email_code") {
        await advance((await signUp!.attemptEmailAddressVerification({ code: code.trim() })) as SignUpResult);
      } else if (step === "phone_code") {
        await advance((await signUp!.attemptPhoneNumberVerification({ code: code.trim() })) as SignUpResult);
      } else {
        await advance(
          (await signUp!.update({
            ...(missing.includes("first_name") ? { firstName: form.first_name.trim() } : {}),
            ...(missing.includes("last_name") ? { lastName: form.last_name.trim() } : {}),
            ...(missing.includes("password") ? { password: form.password } : {}),
            ...(missing.includes("phone_number") ? { phoneNumber: phone() } : {}),
          })) as SignUpResult,
        );
      }
    } catch (e) {
      setError(clerkMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const coding = step === "email_code" || step === "phone_code";
  return (
    <AuthShell
      title={
        step === "email_code"
          ? "Check your email"
          : step === "phone_code"
            ? "Check your phone"
            : step === "more"
              ? "Almost done"
              : "Create your free account"
      }
      subtitle={
        step === "email_code"
          ? `Enter the code sent to ${form.email.trim()}.`
          : step === "phone_code"
            ? `Enter the code texted to ${form.phone_number.trim()}.`
            : step === "more"
              ? "One more thing for your account."
              : "Just an email and a username. Your subscriptions and settings follow you to every device."
      }
      footer={
        <View className="items-center">
          <Text className="font-sans-medium text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/sign-in" replace>
              <Text className="link-text text-sm">Sign in</Text>
            </Link>
          </Text>
          <Link href="/disclosures" className="mt-4">
            <Text className="font-sans text-xs text-muted-foreground underline">Methodology & disclosures</Text>
          </Link>
        </View>
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
      ) : step === "more" ? (
        missing.map((f) => (
          <Field
            key={f}
            label={EXTRA_LABEL[f]}
            value={form[f]}
            onChangeText={set(f)}
            secure={f === "password"}
            keyboardType={f === "phone_number" ? "phone-pad" : "default"}
            autoComplete={f === "password" ? "new-password" : undefined}
            autoCapitalize={f === "first_name" || f === "last_name" ? "words" : "none"}
            placeholder={f === "phone_number" ? "(555) 555-0100" : undefined}
          />
        ))
      ) : (
        <>
          <Field
            label="Email"
            value={form.email}
            onChangeText={set("email")}
            keyboardType="email-address"
            autoComplete="email"
            placeholder="you@example.com"
          />
          <Field
            label="Username"
            value={form.username}
            onChangeText={set("username")}
            autoComplete="username"
            placeholder="How we'll greet you"
            onSubmitEditing={submit}
          />
        </>
      )}
      {/* The sign-in service's bot protection (CAPTCHA) renders here on the web. */}
      {Platform.OS === "web" && step === "details" ? <View nativeID="clerk-captcha" className="mb-2" /> : null}
      <SubmitButton
        label={coding ? "Verify and continue" : step === "more" ? "Finish" : "Create account"}
        onPress={submit}
        busy={busy}
        ready={isLoaded}
      />
    </AuthShell>
  );
}
