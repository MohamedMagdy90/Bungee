import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { notFound } from "next/navigation";
import Script from "next/script";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { isRtl, routing } from "@/i18n/routing";
import "../globals.css";

/** IBM Plex Sans (Latin), self-hosted + subset. Plex Arabic is declared in globals.css (unicode-range gated). */
const plex = localFont({
  src: [
    { path: "../fonts/plex-sans-regular.woff2", weight: "400", style: "normal" },
    { path: "../fonts/plex-sans-medium.woff2", weight: "500", style: "normal" },
    { path: "../fonts/plex-sans-semibold.woff2", weight: "600", style: "normal" },
    { path: "../fonts/plex-sans-bold.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-plex",
  display: "swap",
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
});

type Params = { params: Promise<{ locale: string }> };

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://bungeefly.qa"),
    title: t("title"),
    description: t("description"),
    applicationName: t("appName"),
    alternates: { canonical: `/${locale}`, languages: { en: "/en", ar: "/ar", "x-default": "/en" } },
    appleWebApp: { capable: true, title: "Bungee Fly", statusBarStyle: "black-translucent" },
    formatDetection: { telephone: false },
    openGraph: {
      type: "website",
      title: t("title"),
      description: t("description"),
      locale: locale === "ar" ? "ar_QA" : "en_QA",
      images: [{ url: "/media/placeholder/hero-lift.webp", width: 1679, height: 937 }],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#0B1F33",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function LocaleLayout({ children, params }: Params & { children: React.ReactNode }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"} className={plex.variable} suppressHydrationWarning>
      <head>
        {/* Marks JS as available before paint so scroll-reveal styles never hide content without it. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
        {locale === "ar" && (
          <>
            <link rel="preload" href="/fonts/plex-arabic-400.v1.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
            <link rel="preload" href="/fonts/plex-arabic-600.v1.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
          </>
        )}
        <Script crossOrigin="anonymous" src="//unpkg.com/react-grab/dist/index.global.js" />
        <Script crossOrigin="anonymous" src="//unpkg.com/same-runtime/dist/index.global.js" />
      </head>
      <body suppressHydrationWarning>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
