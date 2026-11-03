"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { CheckIcon, DownloadIcon, ShareIcon } from "@/components/brand/icons";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";

type Platform = "unknown" | "ios" | "android" | "installed";
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

/**
 * Installable web app, no store needed. Android/Chrome gets the native prompt;
 * iOS (no beforeinstallprompt) gets the two-step Share → Add to Home Screen hint.
 */
export function InstallPanel() {
  const t = useTranslations("install");
  const [platform, setPlatform] = useState<Platform>("unknown");
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (standalone) return setPlatform("installed");
    const ua = navigator.userAgent;
    const ios = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    if (ios) setPlatform("ios");
    else if (/Android/.test(ua)) setPlatform("android");

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallEvent);
      setPlatform("android");
    };
    const onInstalled = () => setPlatform("installed");
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") setPlatform("installed");
    setPrompt(null);
  };

  return (
    <div className="rounded-lg bg-navy p-6 text-ice md:p-8">
      <div className="flex items-center gap-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-[22%] bg-navy-700 ring-1 ring-ice/10">
          <Logo variant="symbol" className="w-8 text-ice" />
        </span>
        <div>
          <p className="text-body-lg font-semibold">{t("appTitle")}</p>
          <p className="text-meta text-ice/55" dir="ltr">
            bungeefly.qa
          </p>
        </div>
      </div>
      <p className="mt-5 text-body text-ice/70">{t("appBody")}</p>

      <div className="mt-6 border-t border-hairline-dark pt-6">
        {platform === "installed" ? (
          <p className="flex items-center gap-3 text-body font-medium text-aqua">
            <CheckIcon size={20} />
            {t("installed")}
          </p>
        ) : platform === "android" && prompt ? (
          <Button variant="primary" size="lg" onClick={install}>
            <DownloadIcon size={18} />
            {t("installButton")}
          </Button>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {(platform === "unknown" || platform === "ios") && (
              <li className="flex gap-3">
                <ShareIcon size={20} className="mt-0.5 text-aqua" />
                <span>
                  <span className="block text-body font-medium">{t("iosTitle")}</span>
                  <span className="text-meta text-ice/60">{t("iosSteps")}</span>
                </span>
              </li>
            )}
            {(platform === "unknown" || platform === "android") && (
              <li className="flex gap-3">
                <DownloadIcon size={20} className="mt-0.5 text-aqua" />
                <span>
                  <span className="block text-body font-medium">{t("androidTitle")}</span>
                  <span className="text-meta text-ice/60">{t("androidSteps")}</span>
                </span>
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
