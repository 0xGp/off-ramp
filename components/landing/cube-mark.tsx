"use client";

import { motion, useReducedMotion, useSpring, useTransform } from "framer-motion";
import type { CSSProperties, PointerEvent } from "react";

interface FaceColors {
  top: string;
  bottom: string;
  front: string;
  back: string;
  left: string;
  right: string;
}

const LIME: FaceColors = {
  top: "oklch(0.95 0.19 124)",
  bottom: "oklch(0.62 0.15 132)",
  front: "oklch(0.84 0.2 127)",
  back: "oklch(0.84 0.2 127)",
  left: "oklch(0.72 0.18 130)",
  right: "oklch(0.72 0.18 130)",
};

const TEAL: FaceColors = {
  top: "oklch(0.82 0.11 183)",
  bottom: "oklch(0.4 0.07 192)",
  front: "oklch(0.66 0.125 186)",
  back: "oklch(0.66 0.125 186)",
  left: "oklch(0.5 0.09 190)",
  right: "oklch(0.5 0.09 190)",
};

const FACE_TRANSFORMS: Record<keyof FaceColors, string> = {
  front: "translateZ(calc(var(--s) / 2))",
  back: "rotateY(180deg) translateZ(calc(var(--s) / 2))",
  right: "rotateY(90deg) translateZ(calc(var(--s) / 2))",
  left: "rotateY(-90deg) translateZ(calc(var(--s) / 2))",
  top: "rotateX(90deg) translateZ(calc(var(--s) / 2))",
  bottom: "rotateX(-90deg) translateZ(calc(var(--s) / 2))",
};

function Cube({ size, offset, colors }: { size: string; offset: string; colors: FaceColors }) {
  return (
    <div
      className="absolute left-1/2 top-1/2 [transform-style:preserve-3d]"
      style={
        {
          "--s": size,
          width: "var(--s)",
          height: "var(--s)",
          marginLeft: "calc(var(--s) / -2)",
          marginTop: "calc(var(--s) / -2)",
          transform: offset,
        } as CSSProperties
      }
    >
      {(Object.keys(FACE_TRANSFORMS) as (keyof FaceColors)[]).map((face) => (
        <div
          key={face}
          className="absolute inset-0 [backface-visibility:hidden]"
          style={{ background: colors[face], transform: FACE_TRANSFORMS[face] }}
        />
      ))}
    </div>
  );
}

/** Two interlocking CSS 3D cubes that tilt toward the pointer. Static isometric when motion is reduced. */
export function CubeMark({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const tiltX = useSpring(0, { stiffness: 120, damping: 18 });
  const tiltY = useSpring(0, { stiffness: 120, damping: 18 });
  const rotateX = useTransform(tiltX, (v) => -24 + v);
  const rotateY = useTransform(tiltY, (v) => 42 + v);

  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (reduce || e.pointerType !== "mouse") return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - 0.5;
    const py = (e.clientY - r.top) / r.height - 0.5;
    tiltY.set(px * 28);
    tiltX.set(-py * 20);
  };
  const onLeave = () => {
    tiltX.set(0);
    tiltY.set(0);
  };

  return (
    <div
      aria-hidden
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={className}
      style={{ containerType: "inline-size" }}
    >
      <div
        className="relative aspect-square w-full motion-safe:animate-[melo-float_7s_ease-in-out_infinite]"
        style={{ perspective: "1400px" }}
      >
        <div
          className="absolute bottom-[8%] left-1/2 h-[9%] w-[62%] -translate-x-1/2 rounded-[50%] opacity-60 blur-2xl"
          style={{ background: "oklch(0.3 0.02 150 / 0.35)" }}
        />
        <motion.div
          className="absolute inset-0 [transform-style:preserve-3d]"
          style={{ rotateX, rotateY }}
        >
          <Cube size="44cqw" offset="translate3d(-6cqw, -4cqw, -4cqw)" colors={LIME} />
          <Cube size="26cqw" offset="translate3d(16cqw, 12cqw, 14cqw)" colors={TEAL} />
        </motion.div>
      </div>
    </div>
  );
}
