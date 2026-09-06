/**
 * Resolves a vertical's icon NAME (a string column in the database) to a lucide
 * component at render time.
 *
 * This is the only place a vertical touches code, and it deliberately maps names
 * → components rather than industries → components: adding "Gym" through the
 * admin form works with no deploy as long as the admin picks an icon name we
 * already render. Unknown names fall back rather than crash.
 */

"use client";

import {
  Building2,
  GraduationCap,
  Scissors,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Store,
  UtensilsCrossed,
  Dumbbell,
  Plane,
  Car,
  Home,
  Heart,
  Briefcase,
  type LucideIcon,
} from "lucide-react";

/** Icon names an admin can choose from. Not a list of industries. */
export const ICON_CHOICES: { name: string; label: string }[] = [
  { name: "Stethoscope", label: "Medical" },
  { name: "ShoppingBag", label: "Shopping" },
  { name: "GraduationCap", label: "Education" },
  { name: "Building2", label: "Building" },
  { name: "UtensilsCrossed", label: "Food" },
  { name: "Scissors", label: "Beauty" },
  { name: "Dumbbell", label: "Fitness" },
  { name: "Plane", label: "Travel" },
  { name: "Car", label: "Vehicles" },
  { name: "Home", label: "Home" },
  { name: "Heart", label: "Care" },
  { name: "Store", label: "Shop" },
  { name: "Briefcase", label: "Services" },
];

const ICONS: Record<string, LucideIcon> = {
  Stethoscope,
  ShoppingBag,
  GraduationCap,
  Building2,
  UtensilsCrossed,
  Scissors,
  Dumbbell,
  Plane,
  Car,
  Home,
  Heart,
  Store,
  Briefcase,
};

export function VerticalIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && ICONS[name]) || Sparkles;
  return <Icon className={className} aria-hidden="true" />;
}
