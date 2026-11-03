"use client";

import { useTranslations } from "next-intl";
import { CheckIcon } from "@/components/brand/icons";
import { useBranch } from "@/components/site/branch-context";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function StudioSelectButton({ slug }: { slug: string }) {
  const t = useTranslations("studios");
  const { branch, setBranch } = useBranch();
  const mine = branch?.slug === slug;

  if (mine) {
    return (
      <span className={cn(buttonVariants({ variant: "navy", size: "sm" }), "pointer-events-none")}>
        <CheckIcon size={16} />
        {t("yourStudio")}
      </span>
    );
  }
  return (
    <button type="button" onClick={() => setBranch(slug)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
      {t("setStudio")}
    </button>
  );
}
