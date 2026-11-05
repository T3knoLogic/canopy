import { useEffect, useRef } from "react";
import type { TabKind } from "./holoTypes";

export type HoloMode = "background" | "hero" | "stage";

type Props = {
  mode: HoloMode;
  tab?: TabKind;
  embed?: boolean;
  className?: string;
};

/**
 * Procedural holographic neon models (Three.js).
 * Always mounts WebGL when possible — reduced-motion only slows animation.
 */
export function CanopyHoloScene({
  mode,
  tab = "tokens",
  embed,
  className,
}: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    let raf = 0;
    let renderer: import("three").WebGLRenderer | null = null;
    let cleanupResize: (() => void) | null = null;
    let applyTabVisibility: ((t: TabKind) => void) | null = null;

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    void (async () => {
      try {
        const THREE = await import("three");
        if (disposed || !mount) return;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(
          mode === "stage" || mode === "hero" ? 40 : 48,
          1,
          0.1,
          80,
        );
        if (mode === "background") camera.position.set(0.15, 0.25, 3.6);
        else camera.position.set(0, 0.05, 3.0);

        renderer = new THREE.WebGLRenderer({
          antialias: true,
          alpha: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setClearColor(0x000000, 0);
        const canvas = renderer.domElement;
        canvas.style.display = "block";
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        mount.appendChild(canvas);

        const neonJade = 0x7dffb2;
        const neonMint = 0xd4ffe8;
        const neonGold = 0xe8ff9a;
        const neonCyan = 0x8ffff0;

        const wire = (color: number, opacity = 1) =>
          new THREE.MeshBasicMaterial({
            color,
            wireframe: true,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });

        const solidGlow = (color: number, opacity = 0.22) =>
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });

        const root = new THREE.Group();
        scene.add(root);
        const baseY = mode === "background" ? (embed ? 0.15 : 0.25) : 0;

        // Bright point for punch
        const light = new THREE.PointLight(0xa8ffcf, 2.2, 12);
        light.position.set(0, 1.2, 2);
        scene.add(light);
        scene.add(new THREE.AmbientLight(0x88ffcc, 0.35));

        const rings = new THREE.Group();
        root.add(rings);
        for (let i = 0; i < 3; i++) {
          const torus = new THREE.Mesh(
            new THREE.TorusGeometry(0.95 + i * 0.28, 0.028, 10, 96),
            wire(i === 1 ? neonCyan : neonJade, 0.85),
          );
          torus.rotation.x = Math.PI / 2 + i * 0.2;
          torus.rotation.y = i * 0.45;
          rings.add(torus);
        }

        const disc = new THREE.Mesh(
          new THREE.RingGeometry(0.4, 1.5, 64),
          solidGlow(neonJade, 0.18),
        );
        disc.rotation.x = -Math.PI / 2;
        disc.position.y = -0.9;
        root.add(disc);

        // —— Holdings vault ——
        const vault = new THREE.Group();
        const canopySolid = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.78, 1),
          solidGlow(neonJade, 0.16),
        );
        canopySolid.scale.set(1.2, 0.82, 1.1);
        vault.add(canopySolid);
        const canopy = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.78, 1),
          wire(neonMint, 0.95),
        );
        canopy.scale.copy(canopySolid.scale);
        vault.add(canopy);
        const core = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.32, 0),
          wire(neonGold, 1),
        );
        vault.add(core);
        const coreFill = new THREE.Mesh(
          new THREE.OctahedronGeometry(0.28, 0),
          solidGlow(neonGold, 0.45),
        );
        vault.add(coreFill);
        root.add(vault);

        // —— Send beam ——
        const beam = new THREE.Group();
        const shaft = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 2.0, 8, 1, true),
          wire(neonCyan, 1),
        );
        shaft.rotation.z = Math.PI / 2;
        beam.add(shaft);
        const tip = new THREE.Mesh(
          new THREE.ConeGeometry(0.22, 0.42, 10),
          wire(neonMint, 1),
        );
        tip.position.x = 1.15;
        tip.rotation.z = -Math.PI / 2;
        beam.add(tip);
        const packet = new THREE.Mesh(
          new THREE.BoxGeometry(0.28, 0.28, 0.28),
          wire(neonGold, 1),
        );
        beam.add(packet);
        beam.visible = false;
        root.add(beam);

        // —— Swap ——
        const swap = new THREE.Group();
        const knot = new THREE.Mesh(
          new THREE.TorusKnotGeometry(0.48, 0.14, 140, 18),
          wire(neonCyan, 0.95),
        );
        swap.add(knot);
        const knotFill = new THREE.Mesh(
          new THREE.TorusKnotGeometry(0.48, 0.1, 100, 12),
          solidGlow(neonCyan, 0.2),
        );
        swap.add(knotFill);
        const orbitA = new THREE.Mesh(
          new THREE.TorusGeometry(0.85, 0.03, 10, 72),
          wire(neonJade, 0.9),
        );
        orbitA.rotation.x = Math.PI / 2.4;
        swap.add(orbitA);
        swap.visible = false;
        root.add(swap);

        // —— Cycles lattice ——
        const lattice = new THREE.Group();
        const grid = new THREE.Mesh(
          new THREE.BoxGeometry(1.25, 1.25, 1.25, 3, 3, 3),
          wire(neonJade, 0.85),
        );
        lattice.add(grid);
        const spark = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.28, 0),
          wire(neonMint, 1),
        );
        lattice.add(spark);
        const bits: import("three").Mesh[] = [];
        for (let i = 0; i < 6; i++) {
          const bit = new THREE.Mesh(
            new THREE.TetrahedronGeometry(0.12),
            wire(neonGold, 1),
          );
          bits.push(bit);
          lattice.add(bit);
        }
        lattice.visible = false;
        root.add(lattice);

        // Chromatic ghost
        const ghost = vault.clone(true);
        ghost.traverse((obj) => {
          if (obj instanceof THREE.Mesh && obj.material) {
            const m = (obj.material as import("three").MeshBasicMaterial).clone();
            m.color = new THREE.Color(neonCyan);
            m.opacity = Math.min(0.55, (m.opacity ?? 0.5) * 0.7);
            obj.material = m;
          }
        });
        ghost.position.x = 0.045;
        ghost.scale.multiplyScalar(1.03);
        root.add(ghost);

        applyTabVisibility = (t: TabKind) => {
          vault.visible = t === "tokens" || t === "nfts";
          beam.visible = t === "tokens";
          swap.visible = false;
          lattice.visible = t === "cycles";
          ghost.visible = t === "nfts";
        };
        applyTabVisibility(tabRef.current);

        if (mode === "background") {
          root.scale.setScalar(embed ? 1.0 : 1.35);
          root.position.set(embed ? 0.55 : 0.95, baseY, 0);
        } else {
          root.scale.setScalar(embed ? 0.95 : 1.15);
          root.position.set(0, baseY, 0);
        }

        const resize = () => {
          if (!renderer || !mount) return;
          const w = Math.max(mount.clientWidth, 1);
          const h = Math.max(mount.clientHeight, 1);
          renderer.setSize(w, h, false);
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
        };
        resize();
        // Retry once after layout
        requestAnimationFrame(resize);
        const ro = new ResizeObserver(resize);
        ro.observe(mount);
        cleanupResize = () => ro.disconnect();

        const clock = new THREE.Clock();
        const speed = reduced ? 0.15 : 1;

        const tick = () => {
          if (disposed || !renderer) return;
          applyTabVisibility?.(tabRef.current);
          const t = clock.getElapsedTime() * speed;
          root.rotation.y = t * (mode === "background" ? 0.18 : 0.32);
          root.position.y = baseY + Math.sin(t * 1.1) * 0.08;
          rings.rotation.z = t * 0.28;
          rings.rotation.x = Math.sin(t * 0.4) * 0.2;
          disc.rotation.z = t * 0.35;
          canopy.rotation.y = t * 0.45;
          canopySolid.rotation.y = t * 0.45;
          core.rotation.x = t * 0.75;
          core.rotation.y = t * 0.55;
          coreFill.rotation.copy(core.rotation);
          packet.position.x = Math.sin(t * 1.6) * 0.85;
          packet.rotation.x = t * 1.4;
          packet.rotation.y = t;
          knot.rotation.x = t * 0.5;
          knot.rotation.y = t * 0.65;
          knotFill.rotation.copy(knot.rotation);
          orbitA.rotation.z = t * 0.85;
          spark.rotation.y = t * 1.3;
          lattice.rotation.x = Math.sin(t * 0.45) * 0.25;
          for (let i = 0; i < bits.length; i++) {
            const a = (i / bits.length) * Math.PI * 2 + t * 0.65;
            bits[i].position.set(
              Math.cos(a) * 0.95,
              Math.sin(a * 1.3 + t) * 0.45,
              Math.sin(a) * 0.95,
            );
            bits[i].rotation.x = t + i;
            bits[i].rotation.y = t * 0.9;
          }
          ghost.rotation.y = -t * 0.22;
          ghost.position.y = Math.sin(t * 1.3) * 0.05;
          renderer.render(scene, camera);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        console.error("[CanopyHoloScene] failed to init WebGL", err);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cleanupResize?.();
      if (renderer) {
        renderer.dispose();
        if (renderer.domElement.parentElement === mount) {
          mount.removeChild(renderer.domElement);
        }
      }
    };
  }, [mode, embed]);

  return (
    <div
      className={`canopy-holo canopy-holo--${mode}${className ? ` ${className}` : ""}`}
      ref={mountRef}
      aria-hidden
    />
  );
}
