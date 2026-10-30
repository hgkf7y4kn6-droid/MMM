import { Component, lazy, Suspense, type ReactNode } from "react";
import { View } from "react-native";

import { LogoMark } from "@/components/logo";

const Hero3D = lazy(() => import("@/components/hero-3d"));

/** Shown while the 3D scene loads, and when the device can't run WebGL. */
function Fallback({ height }: { height: number }) {
  return (
    <View className="items-center justify-center" style={{ height }}>
      <LogoMark size={Math.min(160, height * 0.5)} />
    </View>
  );
}

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** The hero's 3D scene, loaded on demand and replaced by the logo if it can't render. */
export function HeroVisual({ height = 420 }: { height?: number }) {
  const fallback = <Fallback height={height} />;
  return (
    <View style={{ height, width: "100%" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Boundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <Hero3D />
        </Suspense>
      </Boundary>
    </View>
  );
}
