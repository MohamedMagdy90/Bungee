import { cn } from "@/lib/utils";

/** "01 — Programmes": numbered index, short orange rule, tracked caps (Brand §15). */
export function SectionLabel({
  index,
  tone = "dark",
  className,
  children,
}: {
  index: string;
  tone?: "dark" | "light";
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <p className={cn("flex items-center gap-3", tone === "dark" ? "text-ice/70" : "text-steel", className)}>
      <span className="tabular text-caption font-medium tracking-[0.12em]">{index}</span>
      <span aria-hidden="true" className="h-[2px] w-8 bg-orange" />
      <span className="label-caps">{children}</span>
    </p>
  );
}
