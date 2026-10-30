import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { Link, router } from "expo-router";
import { useRef, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, useColorScheme, useWindowDimensions, View } from "react-native";

import { HeroVisual } from "@/components/hero-visual";
import { Icon } from "@/components/icon";
import { Logo } from "@/components/logo";
import { Magnetic } from "@/components/magnetic";
import { Reveal } from "@/components/reveal";
import { SafeAreaView } from "@/components/safe-area-view";
import type { IconName } from "@/constants/icons";
import { useSmoothScroll } from "@/lib/use-smooth-scroll";

const WIDE = 900;

const PILLARS: { icon: IconName; title: string; text: string }[] = [
  { icon: "eye", title: "See clearly", text: "Every subscription and renewal in one place, with monthly and yearly totals and what's due next." },
  { icon: "analytics", title: "Make smarter choices", text: "Dividend history, payout safety and growth, laid out against the numbers so you can judge a company yourself." },
  { icon: "trending-up", title: "Grow confidently", text: "Link your brokerage and see your return and dividend income measured against the S&P 500." },
  { icon: "sunny", title: "Live brighter", text: "You stay in control: export or delete your data any time, and we can't move your money." },
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

const UPCOMING = [
  { name: "Streaming", when: "in 3 days", amount: "$15.49" },
  { name: "Music", when: "in 9 days", amount: "$10.99" },
  { name: "Cloud storage", when: "in 12 days", amount: "$2.99" },
];

const GRADIENT = {
  light: ["#0e3b45", "#125a5c", "#1c7a63"],
  dark: ["#0b1d23", "#0e2d33", "#123d3b"],
} as const;

function Section({ children, tone }: { children: ReactNode; tone?: "muted" }) {
  return (
    <View className={tone === "muted" ? "bg-surface" : "bg-background"}>
      <View className="w-full max-w-[1080px] self-center px-6 py-16">{children}</View>
    </View>
  );
}

function Eyebrow({ children, light }: { children: ReactNode; light?: boolean }) {
  return <Text className={`font-sans-bold text-xs uppercase tracking-[3px] ${light ? "text-gold" : "text-primary"}`}>{children}</Text>;
}

/** Gold gradient pill (primary action) or glass outline pill (secondary), with press feedback. */
function Cta({ label, href, variant = "gold" }: { label: string; href: "/sign-up" | "/sign-in"; variant?: "gold" | "ghost" }) {
  const onPress = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(href);
  };
  return (
    <Magnetic>
      <Pressable
        onPress={onPress}
        accessibilityRole="link"
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }], opacity: pressed ? 0.9 : 1 })}
      >
        {variant === "gold" ? (
          <LinearGradient
            colors={["#f3d460", "#d7b740", "#c9992b"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ minHeight: 52, borderRadius: 999, paddingHorizontal: 28, alignItems: "center", justifyContent: "center" }}
          >
            <Text className="font-sans-bold text-base text-[#0e2f38]">{label}</Text>
          </LinearGradient>
        ) : (
          <View className="min-h-[52px] items-center justify-center rounded-full border border-white/40 bg-white/10 px-7">
            <Text className="font-sans-bold text-base text-white">{label}</Text>
          </View>
        )}
      </Pressable>
    </Magnetic>
  );
}

/** An illustration of the product, labelled as sample data. */
function Peek() {
  return (
    <View className="w-full max-w-[380px] self-center rounded-[32px] border border-border bg-card p-5" style={{ boxShadow: "0 24px 60px rgba(14,59,69,0.18)" }}>
      <Text className="font-sans-medium text-xs uppercase tracking-widest text-muted-foreground">Subscriptions this month</Text>
      <Text className="mt-1 font-display-bold text-4xl text-foreground">$184.40</Text>
      <View className="mt-4 h-2 flex-row overflow-hidden rounded-full">
        <View className="flex-[5] bg-primary" />
        <View className="flex-[3] bg-growth" />
        <View className="flex-[2] bg-gold" />
      </View>
      <Text className="mb-1 mt-5 font-sans-bold text-sm text-foreground">Coming up</Text>
      {UPCOMING.map((u) => (
        <View key={u.name} className="flex-row items-center justify-between border-b border-border py-3">
          <View>
            <Text className="font-sans-semibold text-sm text-foreground">{u.name}</Text>
            <Text className="font-sans text-xs text-muted-foreground">{u.when}</Text>
          </View>
          <Text className="font-sans-bold text-sm text-foreground">{u.amount}</Text>
        </View>
      ))}
      <View className="mt-4 flex-row items-center justify-between rounded-2xl bg-muted px-4 py-3">
        <Text className="font-sans-medium text-sm text-foreground">Portfolio vs S&amp;P 500</Text>
        <Text className="font-sans-bold text-sm text-success">+2.4 pts</Text>
      </View>
      <Text className="mt-3 font-sans text-xs text-muted-foreground">Sample data for illustration.</Text>
    </View>
  );
}

/** The page signed-out visitors land on. */
export default function Welcome() {
  const wide = useWindowDimensions().width >= WIDE;
  const dark = useColorScheme() === "dark";
  const scroller = useRef<ScrollView>(null);
  useSmoothScroll(scroller);
  const grad = GRADIENT[dark ? "dark" : "light"];

  return (
    <SafeAreaView className="flex-1 bg-hero" edges={["top", "left", "right"]}>
      <ScrollView ref={scroller} className="flex-1 bg-background" contentContainerClassName="grow">
        <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <View className="w-full max-w-[1080px] self-center px-6 pb-14 pt-6">
            <View className="mb-8 flex-row items-center justify-between">
              <Logo size={30} light />
              <Link href="/sign-in" accessibilityRole="link">
                <Text className="font-sans-semibold text-sm text-white">Sign in</Text>
              </Link>
            </View>
            <View className={wide ? "flex-row items-center gap-8" : "gap-4"}>
              <View className={wide ? "flex-1" : undefined}>
                <Reveal>
                  <Eyebrow light>See a brighter tomorrow</Eyebrow>
                </Reveal>
                <Reveal delay={80}>
                  <Text
                    className="mt-4 font-display text-white"
                    style={{ fontSize: wide ? 58 : 40, lineHeight: wide ? 64 : 46 }}
                    accessibilityRole="header"
                  >
                    Greater financial clarity starts with you.
                  </Text>
                </Reveal>
                <Reveal delay={160}>
                  <Text className="mt-5 max-w-[500px] font-sans text-base leading-7 text-white/80">
                    KaventaFi helps you see more, understand better, and build a brighter tomorrow. Your subscriptions, dividend research and
                    portfolio, together in one place.
                  </Text>
                </Reveal>
                <Reveal delay={240}>
                  <View className="mt-8 flex-row flex-wrap gap-3">
                    <Cta label="Create free account" href="/sign-up" />
                    <Cta label="Sign in" href="/sign-in" variant="ghost" />
                  </View>
                  <Text className="mt-5 font-sans text-xs text-white/60">
                    Free to start · Read-only brokerage linking · We can&apos;t move your money
                  </Text>
                </Reveal>
              </View>
              <View className={wide ? "flex-1" : undefined}>
                <HeroVisual height={wide ? 470 : 300} />
              </View>
            </View>
          </View>
        </LinearGradient>

        <Section>
          <Reveal>
            <Eyebrow>Finances with purpose</Eyebrow>
            <Text className="mt-3 font-display text-3xl tracking-tight text-foreground" accessibilityRole="header">
              Four ways it helps you move forward
            </Text>
          </Reveal>
          <View className={wide ? "mt-10 flex-row gap-4" : "mt-8 gap-4"}>
            {PILLARS.map((p, i) => (
              <Reveal key={p.title} delay={i * 90} className={wide ? "flex-1" : undefined}>
                <View className="h-full rounded-3xl border border-border bg-card p-6">
                  <LinearGradient
                    colors={["#3a6b7e", "#4da167"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={{ width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" }}
                  >
                    <Icon name={p.icon} className="text-2xl text-white" />
                  </LinearGradient>
                  <Text className="mt-4 font-display text-xl text-foreground">{p.title}</Text>
                  <Text className="mt-2 font-sans text-sm leading-6 text-muted-foreground">{p.text}</Text>
                </View>
              </Reveal>
            ))}
          </View>
        </Section>

        <Section tone="muted">
          <View className={wide ? "flex-row items-center gap-16" : "gap-10"}>
            <Reveal className={wide ? "flex-1" : undefined}>
              <Eyebrow>At a glance</Eyebrow>
              <Text className="mt-3 font-display text-3xl tracking-tight text-foreground" accessibilityRole="header">
                Know what&apos;s coming before it hits
              </Text>
              <Text className="mt-3 max-w-[460px] font-sans text-base leading-7 text-muted-foreground">
                Renewals, totals and how your investments are doing against the market, on one calm screen that works the same on your phone and
                in your browser.
              </Text>
            </Reveal>
            <Reveal delay={120} className={wide ? "flex-1" : undefined}>
              <Peek />
            </Reveal>
          </View>
        </Section>

        <Section>
          <Reveal>
            <Eyebrow>How it works</Eyebrow>
            <Text className="mt-3 font-display text-3xl tracking-tight text-foreground" accessibilityRole="header">
              Up and running in minutes
            </Text>
          </Reveal>
          <View className={wide ? "mt-10 flex-row gap-8" : "mt-8 gap-6"}>
            {STEPS.map((s, i) => (
              <Reveal key={s.n} delay={i * 100} className={wide ? "flex-1" : undefined}>
                <LinearGradient
                  colors={["#f3d460", "#d7b740"]}
                  style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" }}
                >
                  <Text className="font-display-bold text-lg text-[#0e2f38]">{s.n}</Text>
                </LinearGradient>
                <Text className="mt-3 font-sans-bold text-base text-foreground">{s.title}</Text>
                <Text className="mt-1 font-sans text-sm leading-6 text-muted-foreground">{s.text}</Text>
              </Reveal>
            ))}
          </View>
        </Section>

        <Section tone="muted">
          <View className={wide ? "flex-row gap-16" : "gap-8"}>
            <Reveal className={wide ? "flex-1" : undefined}>
              <Eyebrow>Built with care</Eyebrow>
              <Text className="mt-3 font-display text-3xl tracking-tight text-foreground" accessibilityRole="header">
                Careful with your money, and honest about the data
              </Text>
              <Text className="mt-3 font-sans text-sm leading-6 text-muted-foreground">
                Every figure carries its source and how fresh it is. Where we don&apos;t have a number, we say so instead of guessing.
              </Text>
            </Reveal>
            <View className={wide ? "flex-1 gap-4" : "gap-4"}>
              {TRUST.map((t, i) => (
                <Reveal key={t.text} delay={i * 80}>
                  <View className="flex-row items-start gap-3">
                    <Icon name={t.icon} className="mt-0.5 text-xl text-primary" />
                    <Text className="flex-1 font-sans-medium text-sm leading-6 text-foreground">{t.text}</Text>
                  </View>
                </Reveal>
              ))}
            </View>
          </View>
        </Section>

        <LinearGradient colors={grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
          <View className="w-full max-w-[1080px] items-center self-center px-6 py-16">
            <Reveal className="items-center">
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
            </Reveal>
          </View>
        </LinearGradient>

        <View className="bg-background">
          <View className="w-full max-w-[1080px] items-center gap-3 self-center px-6 py-8">
            <Logo size={30} tagline />
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
