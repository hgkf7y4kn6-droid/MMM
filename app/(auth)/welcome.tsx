import { Link, router } from "expo-router";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { SafeAreaView } from "@/components/safe-area-view";
import type { IconName } from "@/constants/icons";

const WIDE = 900;

const FEATURES: { icon: IconName; title: string; text: string }[] = [
  {
    icon: "wallet",
    title: "Subscriptions, under control",
    text: "Every recurring charge and renewal in one place, with monthly and yearly totals and what's due next.",
  },
  {
    icon: "analytics",
    title: "Dividend growth research",
    text: "Dividend history, payout safety and growth, laid out against the numbers so you can judge a company yourself.",
  },
  {
    icon: "pie-chart",
    title: "Your portfolio vs the S&P 500",
    text: "Link your brokerage and see your return and dividend income measured against the index.",
  },
];

const STEPS = [
  { n: "1", title: "Create a free account", text: "An email and a username. Nothing else is needed to start tracking." },
  { n: "2", title: "Add what you pay and own", text: "Enter your subscriptions, and link a brokerage on the web when you're ready." },
  { n: "3", title: "See it clearly", text: "Totals, trends and benchmarks, each labelled with where the data came from." },
];

const TRUST: { icon: IconName; text: string }[] = [
  { icon: "lock-closed", text: "Brokerage access tokens are encrypted, and linking runs through Plaid." },
  { icon: "eye", text: "We read your accounts. We can't move your money." },
  { icon: "time", text: "Market data is end-of-day and marked as delayed, never passed off as live." },
  { icon: "download", text: "Export or delete your data whenever you like." },
];

function Section({ children, tone }: { children: React.ReactNode; tone?: "muted" | "hero" }) {
  const bg = tone === "hero" ? "bg-hero" : tone === "muted" ? "bg-surface" : "bg-background";
  return (
    <View className={bg}>
      <View className="w-full max-w-[1080px] self-center px-6 py-14">{children}</View>
    </View>
  );
}

function Cta({ label, href, variant = "gold" }: { label: string; href: "/sign-up" | "/sign-in"; variant?: "gold" | "ghost" | "primary" }) {
  const box =
    variant === "gold"
      ? "bg-gold"
      : variant === "primary"
        ? "bg-primary"
        : "border border-white/40";
  const text = variant === "gold" ? "text-[#16242b]" : "text-white";
  return (
    <Pressable
      className={`min-h-12 items-center justify-center rounded-full px-7 ${box}`}
      onPress={() => router.push(href)}
      accessibilityRole="link"
    >
      <Text className={`font-sans-bold text-base ${text}`}>{label}</Text>
    </Pressable>
  );
}

/** An illustration of the product, labelled as sample data. */
function Preview() {
  const bars = [38, 52, 44, 66, 58, 82];
  return (
    <View className="w-full max-w-[420px] rounded-3xl border border-white/15 bg-white/10 p-5">
      <Text className="font-sans-medium text-xs uppercase tracking-widest text-white/70">This month</Text>
      <Text className="mt-1 font-display-bold text-4xl text-white">$184.40</Text>
      <Text className="font-sans text-sm text-white/70">across 9 subscriptions</Text>
      <View className="mt-5 h-24 flex-row items-end gap-2">
        {bars.map((h, i) => (
          <View
            key={i}
            className={i === bars.length - 1 ? "flex-1 rounded-md bg-gold" : "flex-1 rounded-md bg-white/30"}
            style={{ height: `${h}%` }}
          />
        ))}
      </View>
      <View className="mt-5 flex-row items-center justify-between border-t border-white/15 pt-3">
        <Text className="font-sans-medium text-sm text-white/80">Portfolio vs S&amp;P 500</Text>
        <Text className="font-sans-bold text-sm text-gold">+2.4 pts</Text>
      </View>
      <Text className="mt-3 font-sans text-xs text-white/60">Sample data for illustration.</Text>
    </View>
  );
}

/** The page signed-out visitors land on. */
export default function Welcome() {
  const wide = useWindowDimensions().width >= WIDE;

  return (
    <SafeAreaView className="flex-1 bg-hero" edges={["top", "left", "right"]}>
      <ScrollView className="flex-1 bg-background" contentContainerClassName="grow">
        <Section tone="hero">
          <View className="-mt-6 mb-10 flex-row items-center justify-between">
            <Logo size={34} light />
            <Link href="/sign-in" accessibilityRole="link">
              <Text className="font-sans-semibold text-sm text-white">Sign in</Text>
            </Link>
          </View>
          <View className={wide ? "flex-row items-center gap-16" : "gap-10"}>
            <View className={wide ? "flex-1" : undefined}>
              <Text className="font-sans-bold text-xs uppercase tracking-[3px] text-gold">Personal finance, made calm</Text>
              <Text
                className="mt-4 font-display text-white"
                style={{ fontSize: wide ? 56 : 38, lineHeight: wide ? 62 : 44 }}
                accessibilityRole="header"
              >
                Know what you pay for, and what you own.
              </Text>
              <Text className="mt-5 max-w-[520px] font-sans text-base leading-7 text-white/80">
                Track every subscription, research dividend growth stocks, and see how your portfolio measures up against the S&amp;P 500.
              </Text>
              <View className="mt-8 flex-row flex-wrap gap-3">
                <Cta label="Create free account" href="/sign-up" />
                <Cta label="Sign in" href="/sign-in" variant="ghost" />
              </View>
              <Text className="mt-5 font-sans text-xs text-white/60">
                Free to start · Read-only brokerage linking · We can&apos;t move your money
              </Text>
            </View>
            <Preview />
          </View>
        </Section>

        <Section>
          <Text className="font-sans-bold text-xs uppercase tracking-[3px] text-primary">What you get</Text>
          <Text className="mt-3 font-display text-3xl tracking-tight text-foreground" accessibilityRole="header">
            Three tools, one clear picture
          </Text>
          <View className={wide ? "mt-8 flex-row gap-5" : "mt-8 gap-4"}>
            {FEATURES.map((f) => (
              <View key={f.title} className={wide ? "flex-1 rounded-3xl border border-border bg-card p-6" : "rounded-3xl border border-border bg-card p-6"}>
                <View className="size-12 items-center justify-center rounded-2xl bg-primary">
                  <Icon name={f.icon} className="text-2xl text-primary-foreground" />
                </View>
                <Text className="mt-4 font-display text-xl text-foreground">{f.title}</Text>
                <Text className="mt-2 font-sans text-sm leading-6 text-muted-foreground">{f.text}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Section tone="muted">
          <Text className="font-sans-bold text-xs uppercase tracking-[3px] text-primary">How it works</Text>
          <Text className="mt-3 font-display text-3xl tracking-tight text-foreground" accessibilityRole="header">
            Up and running in minutes
          </Text>
          <View className={wide ? "mt-8 flex-row gap-8" : "mt-8 gap-6"}>
            {STEPS.map((s) => (
              <View key={s.n} className={wide ? "flex-1" : undefined}>
                <View className="size-10 items-center justify-center rounded-full bg-gold">
                  <Text className="font-display-bold text-lg text-[#16242b]">{s.n}</Text>
                </View>
                <Text className="mt-3 font-sans-bold text-base text-foreground">{s.title}</Text>
                <Text className="mt-1 font-sans text-sm leading-6 text-muted-foreground">{s.text}</Text>
              </View>
            ))}
          </View>
        </Section>

        <Section>
          <View className={wide ? "flex-row gap-16" : "gap-8"}>
            <View className={wide ? "flex-1" : undefined}>
              <Text className="font-sans-bold text-xs uppercase tracking-[3px] text-primary">Built with care</Text>
              <Text className="mt-3 font-display text-3xl tracking-tight text-foreground" accessibilityRole="header">
                Careful with your money, and honest about the data
              </Text>
              <Text className="mt-3 font-sans text-sm leading-6 text-muted-foreground">
                Every figure carries its source and how fresh it is. Where we don&apos;t have a number, we say so instead of guessing.
              </Text>
            </View>
            <View className={wide ? "flex-1 gap-4" : "gap-4"}>
              {TRUST.map((t) => (
                <View key={t.text} className="flex-row items-start gap-3">
                  <Icon name={t.icon} className="mt-0.5 text-xl text-primary" />
                  <Text className="flex-1 font-sans-medium text-sm leading-6 text-foreground">{t.text}</Text>
                </View>
              ))}
            </View>
          </View>
        </Section>

        <Section tone="hero">
          <View className="items-center">
            <Text className="text-center font-display text-3xl tracking-tight text-white" accessibilityRole="header">
              Start with a clear view of your money
            </Text>
            <Text className="mt-3 max-w-[480px] text-center font-sans text-sm leading-6 text-white/80">
              Free to start. KaventaFi Pro adds deeper portfolio analytics and company fundamentals when you want them.
            </Text>
            <View className="mt-7 flex-row flex-wrap justify-center gap-3">
              <Cta label="Create free account" href="/sign-up" />
              <Cta label="Sign in" href="/sign-in" variant="ghost" />
            </View>
          </View>
        </Section>

        <View className="bg-background">
          <View className="w-full max-w-[1080px] items-center gap-3 self-center px-6 py-8">
            <Link href="/disclosures" accessibilityRole="link">
              <Text className="font-sans-semibold text-sm text-primary underline">Methodology &amp; disclosures</Text>
            </Link>
            <Text className="max-w-[560px] text-center font-sans text-xs leading-5 text-muted-foreground">
              KaventaFi provides information, not investment advice. Market data is end-of-day and may be delayed.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
