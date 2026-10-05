"use client";

import { cn } from "@/lib/utils";
import { motion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

export interface BentoCardProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  colSpan?: 1 | 2 | 4;
  className?: string;
  children?: ReactNode;
}

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.4, ease: [0.22, 1, 0.36, 1] },
  },
};

const spanClass: Record<NonNullable<BentoCardProps["colSpan"]>, string> = {
  1: "",
  2: "md:col-span-2",
  4: "md:col-span-2 lg:col-span-4",
};

export function BentoCard({
  title,
  description,
  icon,
  colSpan = 1,
  className,
  children,
}: BentoCardProps) {
  return (
    <motion.section
      variants={itemVariants}
      aria-label={title}
      className={cn(
        "flex flex-col gap-4 rounded-2xl border bg-card p-4 text-card-foreground shadow-xs sm:p-5",
        spanClass[colSpan],
        className,
      )}
    >
      <header className="flex items-start gap-3">
        {icon ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-muted text-foreground">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-tight">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </motion.section>
  );
}

export default BentoCard;
