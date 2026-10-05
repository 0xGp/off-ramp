import { cn } from "@/lib/utils";

type Pt = [number, number];

function isoCube(cx: number, cy: number, s: number) {
  const w = s * 0.866;
  const top: Pt = [cx, cy - s];
  const rt: Pt = [cx + w, cy - s / 2];
  const lt: Pt = [cx - w, cy - s / 2];
  const c: Pt = [cx, cy];
  const rb: Pt = [cx + w, cy + s / 2];
  const lb: Pt = [cx - w, cy + s / 2];
  const bottom: Pt = [cx, cy + s];
  const pts = (...p: Pt[]) => p.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return {
    top: pts(top, rt, c, lt),
    left: pts(lt, c, bottom, lb),
    right: pts(c, rt, rb, bottom),
  };
}

const lime = isoCube(38, 50, 30);
const teal = isoCube(62, 64, 19);

/** Static isometric mark: lime cube (escrowed funds) interlocked with teal cube (verified payout). */
export function MeloMark({ className, title = "MELO" }: { className?: string; title?: string }) {
  return (
    <svg viewBox="8 16 76 80" role="img" aria-label={title} className={cn("size-8", className)}>
      <polygon points={lime.top} fill="oklch(0.93 0.2 124)" />
      <polygon points={lime.left} fill="oklch(0.83 0.2 127)" />
      <polygon points={lime.right} fill="oklch(0.7 0.17 131)" />
      <polygon points={teal.top} fill="oklch(0.8 0.12 184)" />
      <polygon points={teal.left} fill="oklch(0.66 0.125 186)" />
      <polygon points={teal.right} fill="oklch(0.47 0.085 190)" />
    </svg>
  );
}
