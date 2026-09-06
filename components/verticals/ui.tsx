/**
 * Primitives for the industry-vertical surfaces — the "workbench" design language
 * from the supplied reference.
 *
 * The rules that make it cohere, in one place so every screen obeys them:
 *   • Warm paper ground, white cards, ONE hairline weight, no shadows.
 *   • Headings: sans, bold, tight tracking, near-black. Body: muted grey.
 *   • Monospace is reserved for machine things — eyebrows, chips, prompt text,
 *     system identifiers. Never for prose a person has to read.
 *   • ONE green accent, used for state and the assisted path. Primary action is
 *     near-black; the assisted action is green-outlined. Nothing else is coloured.
 *
 * Jargon rule (from the brief): the `annotation` slot renders system identifiers
 * like `vertical_template_library`. It is for ADMIN screens only — client-facing
 * surfaces pass plain language or nothing at all.
 */

import { cn } from "@/lib/utils";

/** Small uppercase monospace kicker above a heading. */
export function Eyebrow({
  children,
  tone = "faint",
  className,
}: {
  children: React.ReactNode;
  tone?: "faint" | "accent";
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-mono text-[0.6875rem] uppercase tracking-[0.14em]",
        tone === "accent" ? "text-v-accent" : "text-v-faint",
        className,
      )}
    >
      {children}
    </p>
  );
}

/** Right-aligned system reference. ADMIN ONLY — never on a client surface. */
export function Annotation({ lines, className }: { lines: string[]; className?: string }) {
  return (
    <div className={cn("text-right font-mono text-[0.6875rem] leading-relaxed text-v-faint", className)}>
      {lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  );
}

export function Panel({
  children,
  className,
  as: Tag = "section",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  as?: "section" | "article" | "div";
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={cn("rounded-xl border border-v-line bg-v-surface", className)} {...rest}>
      {children}
    </Tag>
  );
}

export function PanelHeading({
  children,
  className,
  ...rest
}: { children: React.ReactNode; className?: string } & React.HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h2 className={cn("text-[1.375rem] font-bold leading-tight tracking-tight text-v-ink", className)} {...rest}>
      {children}
    </h2>
  );
}

export function Lede({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-base leading-relaxed text-v-muted", className)}>{children}</p>;
}

/** Monospace chip, e.g. a kind or a tier. Machine vocabulary, so mono. */
export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: React.ReactNode;
  tone?: "neutral" | "accent" | "cost";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-2 py-1 font-mono text-[0.6875rem] uppercase tracking-wide",
        tone === "accent" && "bg-v-accentSoft text-v-accent",
        tone === "cost" && "bg-cost/10 text-cost",
        tone === "neutral" && "bg-v-surface2 text-v-faint",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Inset monospace block — prompt text, or an empty-state placeholder. */
export function CodeBlock({
  children,
  dashed = false,
  className,
}: {
  children: React.ReactNode;
  dashed?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-4 py-3.5",
        dashed ? "border border-dashed border-v-line" : "border border-v-line bg-v-surface2",
        className,
      )}
    >
      <pre className="whitespace-pre-wrap break-words font-mono text-[0.8125rem] leading-[1.7] text-v-muted">
        {children}
      </pre>
    </div>
  );
}

const BTN_BASE =
  "inline-flex min-h-[2.75rem] items-center justify-center gap-2 rounded-lg px-5 text-[0.9375rem] font-semibold " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v-accent " +
  "focus-visible:ring-offset-2 focus-visible:ring-offset-v-paper disabled:cursor-not-allowed disabled:opacity-50";

/** The one primary action on a screen. Near-black, per the reference. */
export function ButtonPrimary({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn(BTN_BASE, "bg-v-ink text-v-paper hover:opacity-90", className)} {...props} />;
}

/** The assisted path. Green-outlined — clearly available, never louder than primary. */
export function ButtonAssist({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(BTN_BASE, "border border-v-accent bg-transparent text-v-accent hover:bg-v-accentSoft", className)}
      {...props}
    />
  );
}

export function ButtonQuiet({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(BTN_BASE, "border border-v-line bg-v-surface text-v-ink hover:bg-v-surface2", className)}
      {...props}
    />
  );
}

export function LinkAssist({
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a
      className={cn(BTN_BASE, "border border-v-accent bg-transparent text-v-accent hover:bg-v-accentSoft", className)}
      {...props}
    />
  );
}

/** Status dot — the reference's quiet "this is live" marker. */
export function Dot({ active = true, className }: { active?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-v-accent" : "bg-v-faint", className)}
    />
  );
}

/**
 * The industry badge from the reference header: dot + name + a quiet Change link.
 * `onChange`/`changeHref` are optional — clients may not be allowed to change it.
 */
export function VerticalBadge({
  name,
  changeHref,
  className,
}: {
  name: string;
  changeHref?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-3 rounded-lg border border-v-line bg-v-surface px-4 py-2.5",
        className,
      )}
    >
      <span className="flex items-center gap-2">
        <Dot />
        <span className="text-[0.9375rem] font-medium text-v-ink">{name}</span>
      </span>
      {changeHref && (
        <>
          <span aria-hidden="true" className="h-4 w-px bg-v-line" />
          <a
            href={changeHref}
            className="rounded text-[0.9375rem] text-v-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-v-accent"
          >
            Change
          </a>
        </>
      )}
    </div>
  );
}

/**
 * The message a customer receives. Kept as a distinct object rather than a code
 * block: prompts are machine input (mono), but this is human copy that a
 * receptionist judges by reading it, so it stays in prose type.
 */
export function CustomerMessage({
  text,
  caption = "What your customer sees",
  className,
}: {
  text: string;
  caption?: string;
  className?: string;
}) {
  return (
    <figure className={cn("space-y-2", className)}>
      <div className="rounded-lg rounded-tl-sm border border-v-line bg-v-surface2 px-4 py-3">
        <p className="whitespace-pre-wrap break-words text-[0.9375rem] leading-relaxed text-v-ink">{text}</p>
      </div>
      <figcaption className="font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-v-faint">{caption}</figcaption>
    </figure>
  );
}

/** The standing promise, verbatim from the reference. */
export function ConfirmNote({ className }: { className?: string }) {
  return (
    <span className={cn("text-[0.9375rem] text-v-faint", className)}>
      Pre-fill only — nothing sends until you confirm.
    </span>
  );
}
