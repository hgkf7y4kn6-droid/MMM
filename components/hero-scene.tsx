import { useRef } from "react";
import type { Group, Mesh } from "three";

type UseFrame = typeof import("@react-three/fiber").useFrame;

// Brand colors as raw hex for the 3D materials.
const TEAL = "#3a6b7e";
const GREEN = "#4da167";
const LIME = "#a5e34e";
const GOLD = "#d7b740";

const BARS = [
  { x: -1.25, h: 1.1, color: TEAL },
  { x: -0.15, h: 1.9, color: GREEN },
  { x: 0.95, h: 2.9, color: LIME },
] as const;
const BASE = -1.6;
const COINS = 6;

/**
 * The hero's 3D scene: rising bars, a gold sun and drifting coins. It takes
 * `useFrame` from the caller because the web and native renderers are separate
 * packages that each own their own render loop.
 */
export function createScene(useFrame: UseFrame) {
  function Coin({ i }: { i: number }) {
    const ref = useRef<Mesh>(null);
    useFrame((state) => {
      const m = ref.current;
      if (!m) return;
      const t = state.clock.elapsedTime * 0.5 + i * 1.7;
      m.position.set(Math.cos(t) * (2.1 + (i % 3) * 0.35), Math.sin(t * 1.3) * 1.3 + 0.2, Math.sin(t) * 1.2 - 0.6);
      m.rotation.x = t * 1.5;
      m.rotation.z = t;
    });
    return (
      <mesh ref={ref}>
        <cylinderGeometry args={[0.2, 0.2, 0.05, 32]} />
        <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.3} metalness={0.7} roughness={0.25} />
      </mesh>
    );
  }

  return function Scene({ animate = true }: { animate?: boolean }) {
    const group = useRef<Group>(null);
    const sun = useRef<Mesh>(null);

    useFrame((state) => {
      if (!animate) return;
      const g = group.current;
      if (g) {
        // Ease toward the pointer for a gentle parallax, with a slow idle sway.
        const tx = state.pointer.x * 0.5 + Math.sin(state.clock.elapsedTime * 0.35) * 0.18;
        const ty = -state.pointer.y * 0.25;
        g.rotation.y += (tx - g.rotation.y) * 0.06;
        g.rotation.x += (ty - g.rotation.x) * 0.06;
      }
      if (sun.current) sun.current.position.y = BARS[2].h + BASE + 0.9 + Math.sin(state.clock.elapsedTime * 1.2) * 0.12;
    });

    return (
      <>
        <ambientLight intensity={0.9} />
        <directionalLight position={[3, 5, 5]} intensity={2.4} />
        <pointLight position={[-4, 1, 3]} intensity={18} color="#2bd4c4" />
        <group ref={group}>
          {BARS.map((b) => (
            <mesh key={b.x} position={[b.x, BASE + b.h / 2, 0]}>
              <boxGeometry args={[0.8, b.h, 0.8]} />
              <meshStandardMaterial color={b.color} roughness={0.35} metalness={0.15} />
            </mesh>
          ))}
          <mesh ref={sun} position={[BARS[2].x, BARS[2].h + BASE + 0.9, 0]}>
            <sphereGeometry args={[0.5, 48, 48]} />
            <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.35} metalness={0.5} roughness={0.2} />
          </mesh>
          {Array.from({ length: COINS }, (_, i) => (
            <Coin key={i} i={i} />
          ))}
        </group>
      </>
    );
  };
}
