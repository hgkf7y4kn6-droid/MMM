import { Canvas, useFrame } from "@react-three/fiber";
import { useReducedMotion } from "react-native-reanimated";

import { createScene } from "@/components/hero-scene";

const Scene = createScene(useFrame);

/** The landing hero's 3D scene (web). Transparent, so it sits on the page's own gradient. */
export default function Hero3D() {
  const reduced = useReducedMotion();
  return (
    <Canvas
      camera={{ position: [0, 0.2, 7.5], fov: 38 }}
      dpr={[1, 2]}
      gl={{ alpha: true, antialias: true }}
      frameloop={reduced ? "demand" : "always"}
      style={{ background: "transparent" }}
    >
      <Scene animate={!reduced} />
    </Canvas>
  );
}
