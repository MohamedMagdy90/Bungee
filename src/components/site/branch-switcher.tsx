"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ChevronDownIcon, PinIcon } from "@/components/brand/icons";
import { cn } from "@/lib/utils";
import { useBranch } from "./branch-context";

/** Global studio picker (the old app's location drawer, kept because it works). */
export function BranchSwitcher({ className, compact = false }: { className?: string; compact?: boolean }) {
  const t = useTranslations("nav");
  const { branches, branch, setBranch } = useBranch();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={root} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 items-center gap-2 rounded-pill border border-ice/20 ps-3 pe-2.5 text-meta text-ice transition-colors hover:border-ice/45"
      >
        <PinIcon size={16} className="text-aqua" />
        <span className={cn("truncate", compact ? "max-w-[7.5rem]" : "max-w-[10rem]")}>
          <span className="sr-only">{t("studio")}: </span>
          {branch?.name ?? t("chooseStudio")}
        </span>
        <ChevronDownIcon size={16} className={cn("transition-transform duration-300 ease-cord", open && "rotate-180")} />
      </button>

      <div
        className={cn(
          "absolute end-0 top-[calc(100%+0.5rem)] z-50 w-[19rem] origin-top overflow-hidden rounded-lg bg-ice text-navy shadow-[0_24px_60px_-20px_rgb(6_19_31/0.55)] transition-[opacity,transform] duration-300 ease-cord",
          open ? "visible translate-y-0 opacity-100" : "invisible -translate-y-1 opacity-0",
        )}
      >
        <p className="label-caps border-b border-hairline px-4 pb-2.5 pt-3.5 text-steel">{t("yourStudio")}</p>
        <ul id={listId} role="listbox" aria-label={t("studio")} className="p-1.5">
          {branches.map((b) => {
            const active = b.slug === branch?.slug;
            return (
              <li key={b.id} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => {
                    setBranch(b.slug);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-start transition-colors",
                    active ? "bg-white" : "hover:bg-white/60",
                  )}
                >
                  <span
                    className={cn(
                      "mt-1 grid size-4 shrink-0 place-items-center rounded-full border",
                      active ? "border-navy bg-navy text-ice" : "border-navy/30",
                    )}
                  >
                    {active && <CheckIcon size={11} strokeWidth={3} />}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="text-body font-medium">{b.name}</span>
                    <span className="truncate text-meta text-steel">{b.address}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
