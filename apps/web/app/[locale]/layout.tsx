import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations, setRequestLocale } from "next-intl/server";
// Self-hosted fonts from npm: the build never fetches from Google (deterministic image builds)
import "@fontsource/noto-sans-jp/400.css";
import "@fontsource/noto-sans-jp/500.css";
import "@fontsource/noto-sans-jp/700.css";
import "@fontsource/jetbrains-mono/400.css";
import { routing } from "@/i18n/routing";
import { CLIENT_NAMESPACES } from "@/i18n/client-namespaces";
import { Header, BottomTabs } from "@/components/Nav";
import { LandingBeacon } from "@/components/LandingBeacon";
import { isTestMode } from "@boxrush/services";


export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#3B3FD8" };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "brand" });
  return { title: { default: t("name"), template: `%s | ${t("name")}` }, manifest: "/manifest.webmanifest", icons: { icon: "/icon.svg" } };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({ children, params }: { children: ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const all = await getMessages();
  const clientMessages = Object.fromEntries(CLIENT_NAMESPACES.filter((n) => n in all).map((n) => [n, all[n]]));
  const tc = await getTranslations("common");
  return (
    <html lang={locale}>
      <body className="min-h-dvh font-sans antialiased">
        <NextIntlClientProvider messages={clientMessages}>
          {isTestMode() && (
            <div role="status" data-testid="test-mode-banner" className="bg-warning px-4 py-1 text-center text-xs font-medium text-black">
              {tc("testModeBanner")}
            </div>
          )}
          <Header />
          <main className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-4 md:px-6 lg:pb-12">{children}</main>
          <BottomTabs />
          <LandingBeacon />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
