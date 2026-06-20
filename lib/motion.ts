/**
 * WASend motion tokens — single source of truth for animation.
 *
 * Rules baked in (see design brief):
 *  - micro-interactions 120–200ms, content transitions 200–300ms, nothing > 400ms
 *  - ease-out for entrances, ease-in-out for movement (no linear, no bounce)
 *  - animate transform + opacity ONLY (GPU-friendly; safe on mid-range Android)
 *  - first-load list stagger 30–50ms/item
 *  - prefers-reduced-motion is honored globally in globals.css; components that
 *    branch on it at runtime should use `useReducedMotion()` from framer-motion.
 *
 * Usage:
 *   import { motion } from "framer-motion";
 *   import { fadeUp, staggerContainer, durations, easing } from "@/lib/motion";
 */
import type { Variants, Transition } from "framer-motion";

/** Durations in seconds (framer-motion unit). */
export const durations = {
  micro: 0.16, // 160ms — hover/press/focus
  base: 0.24, // 240ms — content enter
  content: 0.28, // 280ms — route / panel transitions
} as const;

/** Easing curves (cubic-bezier arrays). */
export const easing = {
  out: [0.16, 1, 0.3, 1], // ease-out — entrances
  inOut: [0.4, 0, 0.2, 1], // ease-in-out — movement
} as const;

export const transitions = {
  micro: { duration: durations.micro, ease: easing.out } as Transition,
  base: { duration: durations.base, ease: easing.out } as Transition,
  content: { duration: durations.content, ease: easing.out } as Transition,
  move: { duration: durations.base, ease: easing.inOut } as Transition,
} as const;

/** Entrance: fade + 8px upward slide. Route mounts, empty states, sections. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitions.content },
};

/** Plain fade. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitions.base },
};

/** Stagger parent — children animate in 40ms apart, on FIRST load only. */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.04, delayChildren: 0.02 },
  },
};

/** Stat cards / list rows — fade-up child, pair with staggerContainer. */
export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: transitions.base },
};

/** Modal: scale-and-fade from 0.96. Pair with `backdrop`. */
export const modal: Variants = {
  hidden: { opacity: 0, scale: 0.96 },
  visible: { opacity: 1, scale: 1, transition: transitions.base },
  exit: { opacity: 0, scale: 0.96, transition: transitions.micro },
};

export const backdrop: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: transitions.base },
  exit: { opacity: 0, transition: transitions.micro },
};

/** Drawer: slides from an edge. `dir` picks the axis/offset. */
export const drawer = (dir: "left" | "right" = "right"): Variants => {
  const offset = dir === "right" ? "100%" : "-100%";
  return {
    hidden: { x: offset },
    visible: { x: 0, transition: transitions.move },
    exit: { x: offset, transition: transitions.move },
  };
};

/** Broadcast wizard steps: outgoing slides left, incoming enters from right. */
export const wizardStep: Variants = {
  enter: (dir: number) => ({ opacity: 0, x: dir > 0 ? 24 : -24 }),
  center: { opacity: 1, x: 0, transition: transitions.content },
  exit: (dir: number) => ({
    opacity: 0,
    x: dir > 0 ? -24 : 24,
    transition: transitions.micro,
  }),
};

/** Button press — apply via `whileTap`. */
export const press = { scale: 0.97 } as const;

/** Toast slide-in from corner. */
export const toast: Variants = {
  hidden: { opacity: 0, x: 16, y: -8 },
  visible: { opacity: 1, x: 0, y: 0, transition: transitions.base },
  exit: { opacity: 0, x: 16, transition: transitions.micro },
};
