"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowIcon, ArrowUpRightIcon } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { fmtMoney, fmtNum, pick } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ProductView, ShopAdminPage } from "@/server/admin/catalog";
import { api, DetailEmpty, ListCard, ListEmpty, ListRow, MasterDetail, PageFrame, PageHeader, syncQuery } from "./kit";
import { type MediaItem, MediaProvider, thumbOf, useMedia } from "./media";
import { type StockState, StockChip, StockPanel, type StudioOption, stockState } from "./products";

type Filter = "all" | "low" | "out";
const FILTERS: Filter[] = ["all", "low", "out"];
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RANK: Record<StockState, number> = { ok: 0, low: 1, out: 2 };

/**
 * Front desk › Stock: every shop item whose stock is counted, with what's on the shelf at your studios.
 * Pick one to record a delivery, a return, a shelf count or a move (your studios only; the others are view only).
 */
function Desk({
  initialShop,
  studios,
  editable,
  initialFilter,
  initialId,
  canCatalog,
}: {
  initialShop: ShopAdminPage;
  studios: StudioOption[];
  editable: string[] | null;
  initialFilter: Filter;
  initialId: string | null;
  canCatalog: boolean;
}) {
  const t = useTranslations("manage.stockDesk");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const { byId } = useMedia();
  const [shop, setShop] = useState(initialShop);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [selected, setSelected] = useState<string | null>(initialId);
  const [current, setCurrent] = useState<ProductView | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingItem, setLoadingItem] = useState(false);
  const firstLoad = useRef(true);

  // The studios the list talks about: yours (the ones you can change), else every open studio.
  const live = studios.filter((s) => s.isActive);
  const mine = live.filter((s) => editable === null || editable.includes(s.id));
  const focus = mine.length ? mine : live;

  const loadShop = useCallback(
    async (page: number) => {
      setLoading(true);
      const params = new URLSearchParams({ kind: "shop", desk: "1", page: String(page) });
      if (q.trim()) params.set("q", q.trim());
      if (filter !== "all") params.set("filter", filter);
      const r = await api<ShopAdminPage>(`/api/admin/products?${params}`);
      setLoading(false);
      if (r.ok) setShop(r.data);
    },
    [q, filter],
  );
  // Search as you type (debounced); filter changes reload at once.
  useEffect(() => {
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    const timer = setTimeout(() => void loadShop(1), q ? 280 : 0);
    return () => clearTimeout(timer);
  }, [q, loadShop]); // loadShop changes with the filter, so a filter change reloads too

  // The item being worked on: from the loaded page, else fetched (deep links, items on another page).
  useEffect(() => {
    if (!selected || !UUID_RE.test(selected)) {
      setCurrent(null);
      return;
    }
    const found = shop.items.find((p) => p.id === selected);
    if (found) {
      setCurrent(found);
      return;
    }
    let alive = true;
    setLoadingItem(true);
    api<{ product: ProductView }>(`/api/admin/products?id=${selected}`).then((r) => {
      if (!alive) return;
      setLoadingItem(false);
      if (r.ok) setCurrent(r.data.product);
    });
    return () => {
      alive = false;
    };
  }, [selected, shop.items]);

  const select = (id: string | null) => {
    setSelected(id);
    syncQuery({ id });
  };
  const changeFilter = (f: Filter) => {
    setFilter(f);
    syncQuery({ filter: f === "all" ? null : f });
  };
  const upsert = (p: ProductView) => {
    setShop((s) => ({ ...s, items: s.items.map((i) => (i.id === p.id ? p : i)) }));
    setCurrent(p);
  };

  const worst = (p: ProductView): StockState =>
    focus.reduce<StockState>((w, s) => {
      const st = stockState(p.stock?.[s.id]);
      return RANK[st] > RANK[w] ? st : w;
    }, "ok");
  const shelf = (p: ProductView) => {
    if (focus.length === 1) return t("onShelf", { count: p.stock?.[focus[0].id]?.quantity ?? 0 });
    return focus.map((s) => `${pick(locale, s.nameEn, s.nameAr)} ${fmtNum(p.stock?.[s.id]?.quantity ?? 0, locale)}`).join(" · ");
  };

  const tools = (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("filterLabel")}>
      {FILTERS.map((f) => (
        <button
          key={f}
          type="button"
          role="radio"
          aria-checked={filter === f}
          onClick={() => changeFilter(f)}
          className={cn(
            "h-8 rounded-pill border px-3 text-[0.75rem] font-medium transition-colors",
            filter === f ? "border-navy bg-navy text-ice" : "border-navy/15 text-steel hover:border-navy/35",
          )}
        >
          {t(`filters.${f}`)}
        </button>
      ))}
    </div>
  );

  const list = (
    <ListCard title={t("list")} count={shop.total} countLabel={t("count", { count: shop.total })} search={q} onSearch={setQ} toolbar={tools}>
      {loading && shop.items.length === 0 ? (
        <ListEmpty text={t("loading")} />
      ) : shop.items.length ? (
        shop.items.map((p) => {
          const st = worst(p);
          return (
            <ListRow
              key={p.id}
              selected={p.id === selected}
              onClick={() => select(p.id)}
              title={pick(locale, p.nameEn, p.nameAr)}
              meta={[p.sku, shelf(p)].filter(Boolean).join(" · ")}
              thumb={thumbOf(p.imageMediaId ? byId.get(p.imageMediaId) : null)}
              aside={st !== "ok" ? <StockChip state={st} /> : undefined}
            />
          );
        })
      ) : (
        <ListEmpty text={q || filter !== "all" ? tc("noMatches") : t("empty")} />
      )}
      {shop.pages > 1 && (
        <li className={cn("sticky bottom-0 flex items-center justify-between gap-2 border-t border-navy/[0.08] bg-white px-4 py-2.5", loading && "opacity-60")}>
          <Button size="sm" variant="ghost" onClick={() => loadShop(shop.page - 1)} disabled={shop.page <= 1 || loading}>
            {t("prev")}
          </Button>
          <span className="tabular text-meta text-steel">{t("page", { page: shop.page, pages: shop.pages })}</span>
          <Button size="sm" variant="ghost" onClick={() => loadShop(shop.page + 1)} disabled={shop.page >= shop.pages || loading}>
            {t("next")}
          </Button>
        </li>
      )}
    </ListCard>
  );

  let detail: React.ReactNode;
  if (!selected) detail = <DetailEmpty text={t("pick")} />;
  else if (!current) detail = <DetailEmpty text={loadingItem ? t("loading") : t("pick")} />;
  else {
    const thumb = thumbOf(current.imageMediaId ? byId.get(current.imageMediaId) : null);
    const name = pick(locale, current.nameEn, current.nameAr);
    detail = current.stock ? (
      <StockPanel
        key={current.id}
        item={current}
        studios={studios}
        editable={editable}
        onChanged={upsert}
        heading={
          <div className="flex items-start gap-4">
            <span className="size-16 shrink-0 overflow-hidden rounded-lg bg-navy/[0.06]">
              {thumb ? (
                <img src={thumb} alt="" className="size-full object-cover" />
              ) : (
                <span className="grid size-full place-items-center text-body-lg font-semibold text-navy/45" aria-hidden="true">
                  {name
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((w) => Array.from(w)[0] ?? "")
                    .join("")
                    .toUpperCase()}
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <h2 id="stock-title" className="text-h3 font-semibold text-balance">
                {name}
              </h2>
              <p className="tabular mt-1 text-meta text-steel">
                {[current.sku ? t("sku", { sku: current.sku }) : null, current.price !== null ? fmtMoney(current.price, locale) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {!current.isActive && <p className="mt-1.5 text-meta font-medium text-orange-ember">{t("hidden")}</p>}
            </div>
            {canCatalog && (
              <Link
                href={`/admin/products?tab=shop&id=${current.id}`}
                className="hidden shrink-0 items-center gap-1.5 text-meta font-medium text-navy underline-offset-4 hover:underline sm:inline-flex"
              >
                {t("editItem")}
                <ArrowUpRightIcon size={14} />
              </Link>
            )}
          </div>
        }
      />
    ) : (
      <DetailEmpty text={t("notTracked")} />
    );
  }

  return (
    <PageFrame>
      <PageHeader kicker={t("kicker")} title={t("title")} lede={t("lede")} />
      {mine.length === 0 && editable !== null && (
        <p className="lift mb-4 rounded-lg border border-orange/30 bg-orange/[0.08] px-4 py-3 text-meta text-navy text-pretty">{t("noStudio")}</p>
      )}
      <MasterDetail
        showDetail={selected !== null}
        list={list}
        detail={
          <div className="space-y-4">
            {selected && (
              <button
                type="button"
                onClick={() => select(null)}
                className="inline-flex h-9 items-center gap-1.5 text-meta font-medium text-steel transition-colors hover:text-navy xl:hidden"
              >
                <ArrowIcon size={16} className="rotate-180" />
                {t("back")}
              </button>
            )}
            {detail}
          </div>
        }
      />
    </PageFrame>
  );
}

export function StockDesk({
  shop,
  branches,
  editable,
  media,
  initialFilter,
  initialId,
  canCatalog,
}: {
  shop: ShopAdminPage;
  branches: StudioOption[];
  editable: string[] | null;
  media: MediaItem[];
  initialFilter: Filter;
  initialId: string | null;
  canCatalog: boolean;
}) {
  return (
    <MediaProvider initial={media}>
      <Desk
        initialShop={shop}
        studios={branches}
        editable={editable}
        initialFilter={initialFilter}
        initialId={initialId}
        canCatalog={canCatalog}
      />
    </MediaProvider>
  );
}
