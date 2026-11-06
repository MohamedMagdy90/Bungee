"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLocale, useTranslations } from "next-intl";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckIcon, CloseIcon, PlusIcon } from "@/components/brand/icons";
import { Button } from "@/components/ui/button";
import { fmtNum } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  api,
  Bilingual,
  ConfirmButton,
  CORD,
  type Flash,
  inputClass,
  PageFrame,
  PageHeader,
  SaveBar,
  SelectInput,
  syncQuery,
  TextInput,
  useErrorText,
} from "./kit";
import { copyText, Segmented } from "./orders-desk";

/* ── Types ────────────────────────────────────────────────────────────── */

export type MediaUse = { kind: "location" | "class" | "coach" | "banner" | "product" | "gallery"; label: string };
export type MediaItem = {
  id: string;
  kind: "image" | "video";
  url: string;
  posterUrl: string | null;
  mimeType: string;
  width: number | null;
  height: number | null;
  durationSec: number | null;
  bytes: number | null;
  altEn: string;
  altAr: string;
  focalX: number;
  focalY: number;
  source: "upload" | "link" | "built_in";
  createdAt: string;
  usedIn: MediaUse[];
};

/* ── Preparing files in the browser ───────────────────────────────────── */

const MAX_EDGE = 2400;

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode"));
    img.src = src;
  });
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Large photos are scaled to 2400 px on the long edge and re-encoded (WebP, JPEG where WebP can't be written). */
async function prepareImage(file: File) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let { naturalWidth: w, naturalHeight: h } = img;
    const big = Math.max(w, h) > MAX_EDGE || file.size > 1.8 * 1024 * 1024;
    if (file.type === "image/gif" || !big) return { blob: file as Blob, width: w, height: h };
    const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
    w = Math.round(w * scale);
    h = Math.round(h * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")?.drawImage(img, 0, 0, w, h);
    let blob = await canvasBlob(canvas, "image/webp", 0.86);
    if (!blob || blob.type !== "image/webp") blob = await canvasBlob(canvas, "image/jpeg", 0.86);
    return { blob: blob && blob.size < file.size ? blob : (file as Blob), width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Reads a video's size and length and grabs a poster frame (skipped quietly if the browser can't decode it). */
async function prepareVideo(file: File) {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  const once = (event: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("timeout")), 8000);
      video.addEventListener(
        event,
        () => {
          window.clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      video.addEventListener(
        "error",
        () => {
          window.clearTimeout(timer);
          reject(new Error("decode"));
        },
        { once: true },
      );
    });
  try {
    await once("loadedmetadata");
    const meta = { width: video.videoWidth || null, height: video.videoHeight || null, duration: video.duration || null };
    let poster: Blob | null = null;
    try {
      video.currentTime = Math.min(1, (video.duration || 2) / 3);
      await once("seeked");
      const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      poster = await canvasBlob(canvas, "image/jpeg", 0.82);
    } catch {
      poster = null;
    }
    return { ...meta, poster };
  } catch {
    return { width: null, height: null, duration: null, poster: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadMedia(file: File) {
  const form = new FormData();
  if (file.type.startsWith("image/")) {
    const { blob, width, height } = await prepareImage(file).catch(() => ({ blob: file as Blob, width: 0, height: 0 }));
    const name = blob === file ? file.name : file.name.replace(/\.[^.]+$/, blob.type === "image/webp" ? ".webp" : ".jpg");
    form.set("file", blob, name);
    if (width) form.set("width", String(width));
    if (height) form.set("height", String(height));
  } else {
    const meta = await prepareVideo(file);
    form.set("file", file, file.name);
    if (meta.width) form.set("width", String(meta.width));
    if (meta.height) form.set("height", String(meta.height));
    if (meta.duration) form.set("duration", String(meta.duration));
    if (meta.poster) form.set("poster", meta.poster, "poster.jpg");
  }
  try {
    const res = await fetch("/api/admin/media", { method: "POST", body: form, credentials: "same-origin" });
    const data = (await res.json().catch(() => ({}))) as { item?: MediaItem; error?: string };
    if (!res.ok || !data.item) return { ok: false as const, code: res.status === 413 ? "too_large" : (data.error ?? "generic") };
    return { ok: true as const, item: data.item };
  } catch {
    return { ok: false as const, code: "network" };
  }
}

const ACCEPT = "image/jpeg,image/png,image/webp,image/avif,image/gif,video/mp4,video/webm,video/quicktime";

/* ── Shared library state (one per page) ──────────────────────────────── */

type Ctx = {
  items: MediaItem[];
  byId: Map<string, MediaItem>;
  setItems: React.Dispatch<React.SetStateAction<MediaItem[]>>;
  reload: () => Promise<void>;
};
const MediaContext = createContext<Ctx | null>(null);

export function MediaProvider({ initial, children }: { initial: MediaItem[]; children: React.ReactNode }) {
  const [items, setItems] = useState(initial);
  const byId = useMemo(() => new Map(items.map((m) => [m.id, m])), [items]);
  const reload = useCallback(async () => {
    const r = await api<{ items: MediaItem[] }>("/api/admin/media");
    if (r.ok) setItems(r.data.items);
  }, []);
  return <MediaContext.Provider value={{ items, byId, setItems, reload }}>{children}</MediaContext.Provider>;
}

export function useMedia() {
  const ctx = useContext(MediaContext);
  if (!ctx) throw new Error("useMedia needs <MediaProvider>");
  return ctx;
}

export const thumbOf = (m: MediaItem | undefined | null) => (m ? (m.kind === "video" ? m.posterUrl : m.url) : null);

/* ── Tiles ────────────────────────────────────────────────────────────── */

function Tile({ item, selected, onClick }: { item: MediaItem; selected: boolean; onClick: () => void }) {
  const t = useTranslations("manage.media");
  const locale = useLocale();
  const alt = (locale === "ar" ? item.altAr || item.altEn : item.altEn || item.altAr) || "";
  const thumb = thumbOf(item);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        "group relative aspect-square overflow-hidden rounded-lg bg-navy/[0.06] text-start outline-offset-2 transition-shadow",
        selected ? "ring-[3px] ring-orange" : "hover:ring-2 hover:ring-navy/25",
      )}
    >
      {thumb ? (
        <img
          src={thumb}
          alt={alt}
          loading="lazy"
          className="size-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          style={{ objectPosition: `${item.focalX * 100}% ${item.focalY * 100}%` }}
        />
      ) : item.kind === "video" ? (
        <video src={item.url} muted playsInline preload="metadata" className="size-full object-cover" />
      ) : null}
      {item.kind === "video" && (
        <span className="absolute start-2 top-2 inline-flex h-6 items-center gap-1 rounded-pill bg-navy/80 px-2 text-[0.6875rem] font-semibold text-ice backdrop-blur">
          <svg viewBox="0 0 10 10" className="size-2.5" fill="currentColor" aria-hidden="true">
            <path d="M2 1l7 4-7 4z" />
          </svg>
          {item.durationSec ? `${Math.round(item.durationSec)}s` : t("filters.video")}
        </span>
      )}
      {!alt && (
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy/80 to-transparent px-2 pb-1.5 pt-5 text-[0.6875rem] font-medium text-ice">
          {t("untitled")}
        </span>
      )}
      {selected && (
        <span className="absolute end-2 top-2 grid size-6 place-items-center rounded-pill bg-orange text-navy">
          <CheckIcon size={14} />
        </span>
      )}
    </button>
  );
}

/** Drop zone + file button. Uploads one file after another and reports each result. */
function Uploader({ onUploaded, compact }: { onUploaded: (item: MediaItem) => void; compact?: boolean }) {
  const t = useTranslations("manage.media");
  const errorText = useErrorText();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  async function run(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => ACCEPT.split(",").includes(f.type));
    if (!list.length) return setFlash({ tone: "error", text: errorText("bad_type") });
    setFlash(null);
    for (const f of list) {
      setBusy(f.name);
      const r = await uploadMedia(f);
      if (r.ok) {
        onUploaded(r.item);
        setFlash({ tone: "success", text: t("uploaded") });
      } else {
        setFlash({ tone: "error", text: `${f.name}: ${errorText(r.code)}` });
      }
    }
    setBusy(null);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) void run(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-wrap items-center gap-4 rounded-xl border-2 border-dashed px-5 transition-colors",
        compact ? "py-3" : "py-5",
        over ? "border-orange bg-orange/[0.06]" : "border-navy/15 bg-white",
      )}
    >
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => {
          if (e.target.files?.length) void run(e.target.files);
          e.target.value = "";
        }}
      />
      <Button variant="navy" size="sm" onClick={() => input.current?.click()} disabled={Boolean(busy)} aria-busy={Boolean(busy)}>
        <PlusIcon size={16} />
        {t("upload")}
      </Button>
      <div className="min-w-0 flex-[1_1_12rem] text-meta" aria-live="polite">
        {busy ? (
          <p className="flex items-center gap-2 font-medium text-navy">
            <span className="size-2 animate-pulse rounded-pill bg-orange" aria-hidden="true" />
            {t("uploading", { name: busy })}
          </p>
        ) : flash ? (
          <p className={flash.tone === "error" ? "text-orange-ember" : "text-[#1F7A4D]"}>{flash.text}</p>
        ) : (
          <p className="text-steel">
            {over ? t("dropHere") : t("uploadHint")} {!compact && <span className="text-steel/80">{t("limits")}</span>}
          </p>
        )}
      </div>
    </div>
  );
}

/* ── Add by link ──────────────────────────────────────────────────────── */

function LinkForm({ onAdded, onClose }: { onAdded: (item: MediaItem) => void; onClose: () => void }) {
  const t = useTranslations("manage.media");
  const errorText = useErrorText();
  const [kind, setKind] = useState<"image" | "video">("video");
  const [url, setUrl] = useState("");
  const [poster, setPoster] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setBusy(true);
    setError(null);
    const r = await api<{ item: MediaItem }>("/api/admin/media", "POST", {
      kind,
      url: url.trim(),
      posterUrl: kind === "video" && poster.trim() ? poster.trim() : null,
    });
    setBusy(false);
    if (!r.ok) return setError(errorText(r.code));
    onAdded(r.data.item);
    onClose();
  }

  return (
    <div className="lift rounded-xl border border-navy/10 bg-white p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-body-lg font-semibold">{t("linkTitle")}</h2>
          <p className="mt-0.5 text-meta text-steel text-pretty">{t("linkHint")}</p>
        </div>
        <button type="button" onClick={onClose} aria-label={t("close")} className="rounded-pill p-1.5 text-steel hover:bg-navy/5">
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)]">
        <SelectInput
          label={t("linkKind")}
          value={kind}
          onChange={setKind}
          options={[
            { value: "video", label: t("filters.video") },
            { value: "image", label: t("filters.image") },
          ]}
        />
        <TextInput label={t("linkUrl")} value={url} onChange={setUrl} dir="ltr" type="url" placeholder="https://" />
        {kind === "video" && (
          <TextInput
            className="md:col-start-2"
            label={t("linkPoster")}
            value={poster}
            onChange={setPoster}
            dir="ltr"
            type="url"
            placeholder="https://"
            optional
          />
        )}
      </div>
      {error && <p className="mt-3 text-meta text-orange-ember">{error}</p>}
      <div className="mt-4 flex gap-2">
        <Button onClick={add} disabled={busy || !url.trim().startsWith("https://")} aria-busy={busy}>
          {t("linkAdd")}
        </Button>
      </div>
    </div>
  );
}

/* ── Detail panel ─────────────────────────────────────────────────────── */

function fmtBytes(n: number | null, locale: string) {
  if (!n) return null;
  return n > 1024 * 1024 ? `${fmtNum(Math.round((n / 1024 / 1024) * 10) / 10, locale)} MB` : `${fmtNum(Math.round(n / 1024), locale)} KB`;
}

function MediaDetail({
  item,
  onChange,
  onDeleted,
  onBack,
}: {
  item: MediaItem;
  onChange: (item: MediaItem) => void;
  onDeleted: (id: string) => void;
  onBack: () => void;
}) {
  const t = useTranslations("manage.media");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const errorText = useErrorText();
  const [altEn, setAltEn] = useState(item.altEn);
  const [altAr, setAltAr] = useState(item.altAr);
  const [focal, setFocal] = useState({ x: item.focalX, y: item.focalY });
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<Flash>(null);
  const dirty = altEn !== item.altEn || altAr !== item.altAr || focal.x !== item.focalX || focal.y !== item.focalY;

  async function save() {
    setBusy(true);
    setFlash(null);
    const r = await api<{ item: MediaItem }>("/api/admin/media", "PUT", {
      id: item.id,
      altEn,
      altAr,
      focalX: focal.x,
      focalY: focal.y,
    });
    setBusy(false);
    if (!r.ok) return setFlash({ tone: "error", text: errorText(r.code) });
    onChange(r.data.item);
    setFlash({ tone: "success", text: tc("saved") });
  }

  async function remove() {
    setBusy(true);
    const r = await api(`/api/admin/media?id=${item.id}`, "DELETE");
    setBusy(false);
    if (!r.ok) return setFlash({ tone: "error", text: r.code === "in_use" ? t("inUse") : errorText(r.code) });
    onDeleted(item.id);
  }

  const absolute = item.url.startsWith("http") ? item.url : `${typeof window === "undefined" ? "" : window.location.origin}${item.url}`;
  const facts = [
    t(`source.${item.source}`),
    item.width && item.height ? `${fmtNum(item.width, locale)} × ${fmtNum(item.height, locale)}` : null,
    fmtBytes(item.bytes, locale),
    item.durationSec ? `${fmtNum(Math.round(item.durationSec), locale)}s` : null,
  ].filter(Boolean);

  return (
    <section className="lift overflow-hidden rounded-xl border border-navy/10 bg-white xl:sticky xl:top-6">
      <div className="flex items-center gap-2 border-b border-navy/[0.08] px-5 py-3">
        <button type="button" onClick={onBack} className="text-meta font-medium text-steel hover:text-navy xl:hidden">
          {tc("back")}
        </button>
        <h2 className="text-body font-semibold max-xl:hidden">{t("details")}</h2>
        <p className="ms-auto text-meta text-steel">{facts.join(" · ")}</p>
      </div>

      {/* Preview — click to set the focus point (images). */}
      <div className="bg-navy/[0.04] p-4">
        {item.kind === "image" ? (
          <button
            type="button"
            className="relative block w-full cursor-crosshair overflow-hidden rounded-lg"
            aria-label={t("focus")}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
              const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
              setFocal({ x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
            }}
          >
            <img src={item.url} alt="" className="block max-h-[22rem] w-full object-contain" />
            <motion.span
              aria-hidden="true"
              className="pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-pill border-2 border-white shadow-[0_0_0_2px_rgb(255_100_46),0_4px_12px_rgb(11_31_51/0.4)]"
              animate={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }}
              transition={CORD}
              style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }}
            />
          </button>
        ) : (
          <video
            src={item.url}
            poster={item.posterUrl ?? undefined}
            controls
            playsInline
            preload="metadata"
            className="block max-h-[22rem] w-full rounded-lg bg-navy"
          />
        )}
        {item.kind === "image" && <p className="mt-2 text-[0.75rem] text-steel">{t("focusHint")}</p>}
      </div>

      <div className="space-y-5 px-5 py-5">
        <Bilingual label={t("description")} hint={t("descriptionHint")} en={altEn} ar={altAr} onEn={setAltEn} onAr={setAltAr} multiline rows={2} stack />

        <div>
          <p className="text-meta font-medium">{t("usedIn")}</p>
          {item.usedIn.length ? (
            <ul className="mt-2 space-y-1.5">
              {item.usedIn.map((u, i) => (
                <li key={`${u.kind}-${i}`} className="flex items-center gap-2 text-meta">
                  <span className="rounded-sm bg-aqua/15 px-1.5 py-0.5 text-[0.6875rem] font-semibold text-aqua-lagoon">
                    {t(`uses.${u.kind}`)}
                  </span>
                  <span className="truncate text-navy">{u.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-meta text-steel">{t("notUsed")}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await copyText(absolute);
              setFlash({ tone: "info", text: t("copied") });
            }}
          >
            {t("copyLink")}
          </Button>
          {item.usedIn.length === 0 && (
            <ConfirmButton label={t("delete")} confirmLabel={t("deleteConfirm")} onConfirm={remove} busy={busy} />
          )}
        </div>
      </div>

      <SaveBar
        dirty={dirty}
        busy={busy}
        onSave={save}
        onDiscard={() => {
          setAltEn(item.altEn);
          setAltAr(item.altAr);
          setFocal({ x: item.focalX, y: item.focalY });
        }}
        flash={flash}
      />
    </section>
  );
}

/* ── Library page ─────────────────────────────────────────────────────── */

export function MediaLibrary({ initial, initialId }: { initial: MediaItem[]; initialId: string | null }) {
  const t = useTranslations("manage.media");
  const tc = useTranslations("manage.common");
  const [items, setItems] = useState(initial);
  const [filter, setFilter] = useState<"all" | "image" | "video">("all");
  const [q, setQ] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialId && initial.some((m) => m.id === initialId) ? initialId : null);
  const [linking, setLinking] = useState(false);

  const shown = items.filter(
    (m) =>
      (filter === "all" || m.kind === filter) &&
      (!q.trim() || `${m.altEn} ${m.altAr}`.toLowerCase().includes(q.trim().toLowerCase())),
  );
  const selected = items.find((m) => m.id === selectedId) ?? null;

  const select = (id: string | null) => {
    setSelectedId(id);
    syncQuery({ id });
  };
  const added = (item: MediaItem) => {
    setItems((list) => [item, ...list.filter((m) => m.id !== item.id)]);
    select(item.id);
  };

  return (
    <PageFrame>
      <PageHeader
        kicker={t("kicker")}
        title={t("title")}
        lede={t("lede")}
        actions={
          <Button variant="ghost" size="sm" onClick={() => setLinking((v) => !v)} aria-expanded={linking}>
            {t("addLink")}
          </Button>
        }
      />
      <div className="grid max-w-[84rem] gap-6 xl:grid-cols-[minmax(0,1fr)_25rem] xl:items-start">
        <div className={cn("space-y-4", selected && "max-xl:hidden")}>
          {linking && <LinkForm onAdded={added} onClose={() => setLinking(false)} />}
          <Uploader onUploaded={added} />
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full max-w-xs">
              <Segmented
                id="media-filter"
                label={t("title")}
                value={filter}
                onChange={setFilter}
                options={(["all", "image", "video"] as const).map((v) => ({ value: v, label: t(`filters.${v}`) }))}
              />
            </div>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={tc("search")}
              aria-label={tc("search")}
              className={cn(inputClass, "h-10 max-w-xs flex-1")}
            />
            <p className="text-meta text-steel">{tc("count", { count: shown.length })}</p>
          </div>
          {shown.length ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
              {shown.map((m) => (
                <Tile key={m.id} item={m} selected={m.id === selectedId} onClick={() => select(m.id === selectedId ? null : m.id)} />
              ))}
            </div>
          ) : (
            <p className="rounded-xl border border-dashed border-navy/15 px-5 py-12 text-center text-meta text-steel">
              {items.length ? tc("noMatches") : t("empty")}
            </p>
          )}
        </div>
        <AnimatePresence mode="wait">
          {selected ? (
            <motion.div key={selected.id} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <MediaDetail
                item={selected}
                onBack={() => select(null)}
                onChange={(item) => setItems((list) => list.map((m) => (m.id === item.id ? item : m)))}
                onDeleted={(id) => {
                  setItems((list) => list.filter((m) => m.id !== id));
                  select(null);
                }}
              />
            </motion.div>
          ) : (
            <div key="empty" className="hidden xl:block">
              <p className="rounded-xl border border-dashed border-navy/15 px-6 py-16 text-center text-meta text-steel">
                {tc("pickOne")}
              </p>
            </div>
          )}
        </AnimatePresence>
      </div>
    </PageFrame>
  );
}

/* ── Picker (used by Locations, Classes, Coaches, Homepage) ───────────── */

export function MediaPicker({
  label,
  value,
  onChange,
  allowVideo = false,
  hint,
}: {
  label: string;
  value: string | null;
  onChange: (id: string | null) => void;
  allowVideo?: boolean;
  hint?: string;
}) {
  const t = useTranslations("manage.media");
  const tc = useTranslations("manage.common");
  const locale = useLocale();
  const { items, byId, setItems, reload } = useMedia();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(value);
  const current = value ? byId.get(value) : undefined;
  const thumb = thumbOf(current);
  const choices = items.filter((m) => allowVideo || m.kind === "image");

  useEffect(() => {
    if (!open) return;
    setPending(value);
    void reload();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, value, reload]);

  const alt = current ? (locale === "ar" ? current.altAr || current.altEn : current.altEn || current.altAr) : "";

  return (
    <div>
      <p className="mb-1.5 text-meta font-medium text-navy">{label}</p>
      <div className="flex items-center gap-4 rounded-lg border border-navy/15 bg-white p-2.5 pe-3">
        <span className="relative aspect-[4/3] w-28 shrink-0 overflow-hidden rounded-md bg-navy/[0.06]">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              className="size-full object-cover"
              style={current ? { objectPosition: `${current.focalX * 100}% ${current.focalY * 100}%` } : undefined}
            />
          ) : current?.kind === "video" ? (
            <video src={current.url} muted playsInline preload="metadata" className="size-full object-cover" />
          ) : (
            <span className="grid size-full place-items-center text-[0.75rem] text-steel">{tc("coverNone")}</span>
          )}
          {current?.kind === "video" && (
            <span className="absolute start-1.5 top-1.5 rounded-pill bg-navy/80 px-1.5 text-[0.625rem] font-semibold text-ice">
              {t("filters.video")}
            </span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-meta text-steel">{current ? alt || t("untitled") : hint}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
              {current ? tc("change") : tc("choose")}
            </Button>
            {current && (
              <Button size="sm" variant="quiet" onClick={() => onChange(null)}>
                {tc("clear")}
              </Button>
            )}
          </div>
        </div>
      </div>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-[80] flex items-end justify-center bg-navy/50 p-0 backdrop-blur-sm sm:items-center sm:p-6">
            <button type="button" className="absolute inset-0 cursor-default" aria-label={t("close")} onClick={() => setOpen(false)} />
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={allowVideo ? t("pickerTitleAny") : t("pickerTitle")}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={CORD}
              className="relative flex max-h-[88svh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl bg-ice text-navy shadow-[0_30px_80px_-20px_rgb(6_19_31/0.6)] sm:rounded-2xl"
            >
              <header className="flex items-center gap-3 border-b border-navy/10 bg-white px-5 py-4">
                <h2 className="me-auto text-body-lg font-semibold">{allowVideo ? t("pickerTitleAny") : t("pickerTitle")}</h2>
                <button type="button" onClick={() => setOpen(false)} aria-label={t("close")} className="rounded-pill p-1.5 text-steel hover:bg-navy/5">
                  <CloseIcon size={18} />
                </button>
              </header>
              <div className="space-y-4 overflow-y-auto p-5">
                <Uploader
                  compact
                  onUploaded={(item) => {
                    setItems((list) => [item, ...list.filter((m) => m.id !== item.id)]);
                    if (allowVideo || item.kind === "image") setPending(item.id);
                  }}
                />
                {choices.length ? (
                  <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5">
                    {choices.map((m) => (
                      <Tile key={m.id} item={m} selected={pending === m.id} onClick={() => setPending(m.id)} />
                    ))}
                  </div>
                ) : (
                  <p className="py-10 text-center text-meta text-steel">{t("pickerEmpty")}</p>
                )}
              </div>
              <footer className="flex items-center justify-end gap-2 border-t border-navy/10 bg-white px-5 py-3.5">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  {tc("cancel")}
                </Button>
                <Button
                  disabled={!pending || pending === value}
                  onClick={() => {
                    onChange(pending);
                    setOpen(false);
                  }}
                >
                  {t("pickerUse")}
                </Button>
              </footer>
            </motion.div>
          </div>,
          document.body,
        )}
    </div>
  );
}
