import { cn } from "@/lib/utils";

/**
 * Small, dependency-free charts for the studio-desk overview. Server-rendered (no client JS); every mark has a
 * text equivalent (title / sr-only), and they mirror with the page direction like the rest of the desk.
 */

export function Card({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("lift flex min-w-0 flex-col rounded-xl border border-navy/10 bg-white p-5 sm:p-6", className)}>
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-body-lg font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-meta text-steel text-pretty">{hint}</p>}
        </div>
        {action}
      </header>
      <div className="min-w-0 flex-1">{children}</div>
    </section>
  );
}

export type Delta = { text: string; tone: "up" | "down" | "flat" } | null;

/** One headline number with its change against the previous period. `good` = which direction is good news. */
export function Kpi({
  label,
  value,
  unit,
  sub,
  delta,
  good = "up",
}: {
  label: string;
  value: string;
  /** Small currency / unit shown beside the number, so big amounts never get cut off. */
  unit?: string;
  sub?: string;
  delta?: Delta;
  good?: "up" | "down";
}) {
  const positive = delta && delta.tone !== "flat" && delta.tone === good;
  return (
    <div className="lift min-w-0 rounded-xl border border-navy/10 bg-white p-4 sm:p-5">
      <p className="truncate text-meta text-steel">{label}</p>
      <p className="mt-1.5 flex flex-wrap items-baseline gap-x-1.5 leading-none">
        <span className="tabular whitespace-nowrap text-[1.75rem] font-semibold tracking-tight sm:text-[2rem]">{value}</span>
        {unit && <span className="text-meta font-semibold text-steel">{unit}</span>}
      </p>
      <div className="mt-2 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-[0.75rem]">
        {delta && (
          <span
            className={cn(
              "tabular inline-flex items-center gap-0.5 rounded-pill px-1.5 py-0.5 font-semibold",
              delta.tone === "flat" ? "bg-navy/[0.06] text-steel" : positive ? "bg-[#1F7A4D]/[0.1] text-[#1F7A4D]" : "bg-orange/[0.14] text-orange-ember",
            )}
          >
            {delta.tone === "up" ? "▲" : delta.tone === "down" ? "▼" : "•"} {delta.text}
          </span>
        )}
        {sub && <span className="truncate text-steel">{sub}</span>}
      </div>
    </div>
  );
}

/**
 * Vertical bars, one per day. Optional `ghost` draws the total behind the value (e.g. places booked over capacity).
 * Shows the top value and the first / middle / last labels.
 */
export function DayBars({
  data,
  format,
  empty,
  tone = "navy",
}: {
  data: { key: string; label: string; value: number; ghost?: number; tip: string }[];
  format: (v: number) => string;
  empty: string;
  tone?: "navy" | "orange";
}) {
  const max = Math.max(1, ...data.map((d) => Math.max(d.value, d.ghost ?? 0)));
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <p className="grid h-44 place-items-center rounded-lg bg-navy/[0.03] text-meta text-steel">{empty}</p>;
  const mid = Math.floor((data.length - 1) / 2);
  return (
    <figure>
      <div className="relative">
        <span className="tabular absolute -top-1 start-0 text-[0.6875rem] text-steel">{format(max)}</span>
        <div className="flex h-44 items-end gap-[3px] border-b border-navy/10 pt-5" role="img" aria-label={data.map((d) => d.tip).join("; ")}>
          {data.map((d) => (
            <div key={d.key} className="group relative flex h-full min-w-0 flex-1 items-end" title={d.tip}>
              {d.ghost !== undefined && (
                <span className="absolute inset-x-0 bottom-0 rounded-t-[3px] bg-navy/[0.07]" style={{ height: `${(d.ghost / max) * 100}%` }} />
              )}
              <span
                className={cn(
                  "relative w-full rounded-t-[3px] transition-opacity group-hover:opacity-80",
                  tone === "orange" ? "bg-orange" : "bg-navy",
                )}
                style={{ height: `${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
      </div>
      <figcaption className="mt-2 flex justify-between text-[0.6875rem] text-steel">
        <span>{data[0]?.label}</span>
        {data.length > 2 && <span>{data[mid]?.label}</span>}
        <span>{data[data.length - 1]?.label}</span>
      </figcaption>
    </figure>
  );
}

/** Weekday × hour grid: how full classes are at each time (darker = fuller). */
export function Heatmap({
  cells,
  weekdays,
  hourLabel,
  tip,
  empty,
  legend,
}: {
  cells: { weekday: number; hour: number; fill: number; classes: number }[];
  weekdays: string[];
  hourLabel: (h: number) => string;
  tip: (c: { weekday: number; hour: number; fill: number; classes: number }) => string;
  empty: string;
  legend: [string, string];
}) {
  if (cells.length === 0) return <p className="grid h-44 place-items-center rounded-lg bg-navy/[0.03] text-meta text-steel">{empty}</p>;
  const hours = cells.map((c) => c.hour);
  const lo = Math.min(...hours);
  const hi = Math.max(...hours);
  const span = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const at = new Map(cells.map((c) => [`${c.weekday}-${c.hour}`, c]));
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] table-fixed border-separate border-spacing-[3px] text-[0.6875rem]">
          <thead>
            <tr>
              <th className="w-11" />
              {span.map((h) => (
                <th key={h} scope="col" className="tabular font-normal text-steel">
                  {h % 2 === lo % 2 ? hourLabel(h) : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weekdays.map((w, wd) => (
              <tr key={w}>
                <th scope="row" className="pe-1 text-start font-medium text-steel">
                  {w}
                </th>
                {span.map((h) => {
                  const c = at.get(`${wd}-${h}`);
                  return (
                    <td
                      key={h}
                      title={c ? tip(c) : undefined}
                      className={cn("h-6 rounded-[4px]", !c && "bg-navy/[0.025]")}
                      style={c ? { backgroundColor: `rgb(255 100 46 / ${0.12 + c.fill * 0.88})` } : undefined}
                    >
                      <span className="sr-only">{c ? tip(c) : ""}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex items-center gap-2 text-[0.6875rem] text-steel">
        <span>{legend[0]}</span>
        <span className="h-2 w-24 rounded-pill bg-gradient-to-r from-orange/15 to-orange rtl:bg-gradient-to-l" aria-hidden="true" />
        <span>{legend[1]}</span>
      </div>
    </div>
  );
}

/** Ranked horizontal bars (top classes, best sellers, studios). */
export function RankBars({
  rows,
  empty,
}: {
  rows: { key: string; label: string; value: number; display: string; sub?: string }[];
  empty: string;
}) {
  if (rows.length === 0) return <p className="rounded-lg bg-navy/[0.03] px-4 py-8 text-center text-meta text-steel">{empty}</p>;
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ol className="space-y-3">
      {rows.map((r, i) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-3 text-meta">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="tabular w-4 shrink-0 text-steel">{i + 1}</span>
              <span className="truncate font-medium">{r.label}</span>
            </span>
            <span className="tabular shrink-0 font-semibold">{r.display}</span>
          </div>
          <div className="ms-6 mt-1.5 flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-navy/[0.06]">
              <span className="block h-full rounded-pill bg-navy" style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            {r.sub && <span className="tabular w-24 shrink-0 text-end text-[0.75rem] text-steel">{r.sub}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** One stacked bar + legend (sales mix). */
export function MixBar({ parts, empty }: { parts: { key: string; label: string; value: number; display: string; color: string }[]; empty: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (total === 0) return <p className="rounded-lg bg-navy/[0.03] px-4 py-6 text-center text-meta text-steel">{empty}</p>;
  return (
    <div>
      <div className="flex h-3 overflow-hidden rounded-pill" role="img" aria-label={parts.map((p) => `${p.label} ${p.display}`).join(", ")}>
        {parts
          .filter((p) => p.value > 0)
          .map((p) => (
            <span key={p.key} style={{ width: `${(p.value / total) * 100}%`, backgroundColor: p.color }} title={`${p.label} · ${p.display}`} />
          ))}
      </div>
      <ul className="mt-4 divide-y divide-navy/[0.06] text-meta">
        {parts.map((p) => (
          <li key={p.key} className={cn("flex min-w-0 items-center gap-3 py-2.5", p.value === 0 && "text-steel")}>
            <span className="size-2.5 shrink-0 rounded-[3px]" style={{ backgroundColor: p.color }} aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate">{p.label}</span>
            <span className="tabular shrink-0 font-semibold">{p.display}</span>
            <span className="tabular w-11 shrink-0 text-end text-steel">{Math.round((p.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Thin progress bar with a label on each end (fill rate, check-in progress). */
export function Meter({ value, max, tone = "navy" }: { value: number; max: number; tone?: "navy" | "green" | "orange" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="block h-1.5 overflow-hidden rounded-pill bg-navy/[0.08]" aria-hidden="true">
      <span
        className={cn("block h-full rounded-pill", tone === "green" ? "bg-[#1F7A4D]" : tone === "orange" ? "bg-orange" : "bg-navy")}
        style={{ width: `${pct}%` }}
      />
    </span>
  );
}
