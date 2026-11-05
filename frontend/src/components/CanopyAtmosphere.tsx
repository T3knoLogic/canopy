import { useEffect, useRef } from "react";

export type CanopyAtmosphereVariant = "standalone" | "embed";

type Props = {
  variant?: CanopyAtmosphereVariant;
};

function MoteCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let w = 0;
    let h = 0;

    const particles = Array.from({ length: 72 }, () => ({
      x: Math.random(),
      y: Math.random(),
      z: Math.random(),
      vx: (Math.random() - 0.5) * 0.00028,
      vy: (Math.random() - 0.5) * 0.0002,
    }));

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const draw = (t: number) => {
      ctx.fillStyle = "rgba(2, 5, 4, 0.16)";
      ctx.fillRect(0, 0, w, h);

      const cx = w * 0.5;
      const cy = h * 0.28;
      const pulse = 0.85 + Math.sin(t * 0.0007) * 0.12;
      const coreR = Math.min(w, h) * 0.15 * pulse;

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR * 3.1);
      grad.addColorStop(0, "rgba(94, 207, 138, 0.28)");
      grad.addColorStop(0.4, "rgba(61, 139, 95, 0.12)");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, coreR * 3.1, 0, Math.PI * 2);
      ctx.fill();

      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > 1) p.vx *= -1;
        if (p.y < 0 || p.y > 1) p.vy *= -1;

        const px = p.x * w;
        const py = p.y * h;
        const size = 0.7 + p.z * 2.2;
        ctx.fillStyle = `rgba(197, 232, 168, ${0.12 + p.z * 0.38})`;
        ctx.shadowColor = "rgba(94, 207, 138, 0.45)";
        ctx.shadowBlur = 6 + p.z * 8;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      raf = requestAnimationFrame(draw);
    };

    resize();
    raf = requestAnimationFrame(draw);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <canvas ref={canvasRef} className="canopy-atmosphere__canvas" aria-hidden />
  );
}

export function CanopyAtmosphere({ variant = "standalone" }: Props) {
  const embed = variant === "embed";
  const reduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <div
      className={`canopy-atmosphere${embed ? " embed" : ""}`}
      aria-hidden
    >
      <div className="canopy-atmosphere__base" />
      <div className="canopy-atmosphere__plate" />
      <div className="canopy-atmosphere__mesh" />
      {!embed && !reduced ? <MoteCanvas /> : null}
      <div className="canopy-grain" />
      <div className="canopy-vignette" />
      <div className="canopy-atmosphere__hairline" />
    </div>
  );
}
