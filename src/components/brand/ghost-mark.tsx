import { cn } from "@/lib/utils";
import { Logo } from "./logo";

/** Oversized symbol bleeding off the page edge at very low opacity (Brand §16). One per layout. */
export function GhostMark({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("pointer-events-none absolute select-none", className)}>
      <Logo variant="symbol" className="w-full" />
    </div>
  );
}
