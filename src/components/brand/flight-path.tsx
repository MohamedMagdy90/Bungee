import { cn } from "@/lib/utils";

/**
 * The cord (Brand §16 "flight path"): drops from the rigging, loops around the flyer, swings out.
 * One per layout. Drawn once on load. Two artboards so the loop stays on the athlete at every
 * aspect ratio; both keep to the photograph and never cross running text.
 */
export function FlightPath({ className, delay = 0 }: { className?: string; delay?: number }) {
  const style = { "--path-delay": `${delay}ms` } as React.CSSProperties;
  return (
    <div aria-hidden="true" className={cn("pointer-events-none", className)}>
      {/* Phones / tablets: portrait crop, photo above the headline */}
      <svg viewBox="0 0 400 520" preserveAspectRatio="xMidYMin slice" className="size-full lg:hidden" fill="none">
        <path
          pathLength={1}
          className="flight-path-stroke"
          style={style}
          d="M232 -10 L232 132 C232 250 338 318 366 250 C392 186 330 140 288 184 C240 236 262 352 336 392 C376 413 408 414 440 402"
          stroke="currentColor"
          strokeWidth={9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* Desktop: landscape crop, photo on the inline-end side */}
      <svg viewBox="0 0 860 800" preserveAspectRatio="xMidYMin slice" className="hidden size-full lg:block" fill="none">
        <path
          pathLength={1}
          className="flight-path-stroke"
          style={style}
          d="M478 -10 L478 214 C478 404 640 506 720 420 C798 336 704 222 600 286 C488 356 524 566 676 642 C766 688 848 684 900 660"
          stroke="currentColor"
          strokeWidth={13}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
