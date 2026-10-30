import { Canvas, useFrame } from "@react-three/fiber/native";
import { useReducedMotion } from "react-native-reanimated";

import { createScene } from "@/components/hero-scene";

const Scene = createScene(useFrame as Parameters<typeof createScene>[0]);

/** The landing hero's 3D scene (iOS and Android, through expo-gl; needs Expo Go or a development build). */
export default function Hero3D() {
  const reduced = useReducedMotion();
  return (
    <Canvas
      camera={{ position: [0, 0.2, 7.5], fov: 38 }}
      frameloop={reduced ? "demand" : "always"}
      gl={{ antialias: true }}
    >
      <Scene animate={!reduced} />
    </Canvas>
  );
}
