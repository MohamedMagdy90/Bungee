"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { BRANCH_COOKIE } from "@/lib/constants";

export type BranchLite = { id: string; slug: string; name: string; address: string };

type Ctx = {
  branches: BranchLite[];
  branch: BranchLite | null;
  setBranch: (slug: string) => void;
};

const BranchContext = createContext<Ctx | null>(null);

/** The customer's studio, remembered for a year. Drives timetable + per-branch prices. */
export function BranchProvider({
  branches,
  initialSlug,
  children,
}: {
  branches: BranchLite[];
  initialSlug: string | null;
  children: React.ReactNode;
}) {
  const [slug, setSlug] = useState<string | null>(
    initialSlug && branches.some((b) => b.slug === initialSlug) ? initialSlug : (branches[0]?.slug ?? null),
  );

  const setBranch = useCallback((next: string) => {
    setSlug(next);
    // biome-ignore lint/suspicious/noDocumentCookie: simple preference cookie, read on the server
    document.cookie = `${BRANCH_COOKIE}=${encodeURIComponent(next)}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const value = useMemo(
    () => ({ branches, branch: branches.find((b) => b.slug === slug) ?? null, setBranch }),
    [branches, slug, setBranch],
  );

  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>;
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used inside <BranchProvider>");
  return ctx;
}
