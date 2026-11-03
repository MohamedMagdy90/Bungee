import { cn } from "@/lib/utils";
import { LOGOS, type LogoVariant } from "./logo-art";

type LogoProps = {
  variant?: LogoVariant;
  className?: string;
  /** Accessible name. Omit (decorative) when the logo sits next to the same words. */
  title?: string;
};

/**
 * Vector logo from the master artwork. Single colour via `currentColor` (Brand §6: never recolour
 * parts, never add effects, never mirror — so no RTL flip here).
 */
export function Logo({ variant = "horizontal", className, title }: LogoProps) {
  const art = LOGOS[variant];
  return (
    <svg
      viewBox={`0 0 ${art.w} ${art.h}`}
      fill="currentColor"
      className={cn("block h-auto shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {art.paths.map((p, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static artwork
        <path key={i} d={p.d} fillRule={p.rule} clipRule={p.rule} />
      ))}
    </svg>
  );
}
