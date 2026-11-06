"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import type { ShopImage } from "@/lib/shop";
import { cn } from "@/lib/utils";
import { ProductImage } from "./parts";

export function ProductGallery({ photos, name, tone, dim }: { photos: ShopImage[]; name: string; tone: string; dim?: boolean }) {
  const t = useTranslations("shop");
  const [i, setI] = useState(0);
  const current = photos[i] ?? null;
  return (
    <div className="space-y-3">
      <div className="aspect-square overflow-hidden rounded-xl bg-white ring-1 ring-navy/[0.07]">
        <ProductImage image={current} name={name} tone={tone} sizes="hero" dim={dim} />
      </div>
      {photos.length > 1 && (
        <div role="tablist" aria-label={t("photos")} className="flex gap-2 overflow-x-auto scrollbar-none">
          {photos.map((p, n) => (
            <button
              key={p.url}
              type="button"
              role="tab"
              aria-selected={n === i}
              aria-label={t("photoN", { n: n + 1 })}
              onClick={() => setI(n)}
              className={cn(
                "size-20 shrink-0 overflow-hidden rounded-md ring-2 transition-[box-shadow,opacity]",
                n === i ? "ring-navy" : "opacity-70 ring-transparent hover:opacity-100",
              )}
            >
              <ProductImage image={p} name={name} tone={tone} sizes="thumb" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
