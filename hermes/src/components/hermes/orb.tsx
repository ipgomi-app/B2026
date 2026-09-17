import type { HermesPhase } from "@/lib/hermes/types";
import { cn } from "@/lib/utils";

const TICKS = Array.from({ length: 60 }, (_, i) => {
  const a = (i / 60) * Math.PI * 2;
  const outer = i % 15 === 0 ? 92 : i % 5 === 0 ? 90 : 88;
  const inner = 86;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return {
    key: i,
    x1: Number((100 + cos * inner).toFixed(3)),
    y1: Number((100 + sin * inner).toFixed(3)),
    x2: Number((100 + cos * outer).toFixed(3)),
    y2: Number((100 + sin * outer).toFixed(3)),
    major: i % 15 === 0,
  };
});

type OrbProps = {
  phase: HermesPhase;
  level: number;
  live?: boolean;
  disabled?: boolean;
};

export function HermesOrb({ phase, level, live, disabled }: OrbProps) {
  const active = phase === "listening" || phase === "speaking" || live;
  const mid = 72 + (active ? level * 10 : 0);
  const inner = 46 + (active ? level * 6 : 0);

  return (
    <div
      data-testid="hermes-orb"
      aria-hidden="true"
      className={cn(
        "relative grid size-56 place-items-center rounded-full text-accent sm:size-64",
        disabled && "opacity-40",
      )}
    >
      <svg viewBox="0 0 200 200" className="absolute inset-0 size-full" aria-hidden="true">
        <circle
          cx="100"
          cy="100"
          r="94"
          fill="none"
          stroke="currentColor"
          strokeWidth="0.6"
          className={cn("opacity-30", phase === "idle" && "orb-breathe")}
        />
        <g
          className={cn(
            "origin-center",
            (phase === "thinking" || phase === "speaking") && "orb-spin",
          )}
          style={{ transformOrigin: "100px 100px", animationDuration: "18s", animationTimingFunction: "linear", animationIterationCount: "infinite" }}
        >
          {TICKS.map((t) => (
            <line
              key={t.key}
              x1={t.x1}
              y1={t.y1}
              x2={t.x2}
              y2={t.y2}
              stroke="currentColor"
              strokeWidth={t.major ? 1.2 : 0.6}
              opacity={t.major ? 0.7 : 0.28}
            />
          ))}
        </g>
        <circle
          cx="100"
          cy="100"
          r={mid}
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
          className="opacity-70 transition-[r] duration-75"
        />
        <circle
          cx="100"
          cy="100"
          r={inner}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          className={cn(
            "transition-[r] duration-75",
            phase === "thinking" && "orb-think opacity-90",
          )}
          style={
            phase === "thinking"
              ? { strokeDasharray: "18 10", animation: "orb-think 1.1s linear infinite" }
              : undefined
          }
        />
        <circle
          cx="100"
          cy="100"
          r="28"
          fill="color-mix(in oklab, var(--color-surface) 88%, transparent)"
          stroke="currentColor"
          strokeWidth="0.8"
          opacity="0.9"
        />
      </svg>
      <span className="relative font-sans text-xl font-medium tracking-[0.2em] text-accent">
        H
      </span>
    </div>
  );
}
