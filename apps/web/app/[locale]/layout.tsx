import type { ReactNode } from "react";
import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Noto_Sans_JP, JetBrains_Mono } from "next/font/google";
import { routing } from "@/i18n/routing";
import { Header, BottomTabs } from "@/components/Nav";
import { LandingBeacon } from "@/components/LandingBeacon";

const noto = Noto_Sans_JP({ subsets: ["latin"], weight: ["400", "500", "700"], variable: "--font-noto", display: "swap", preload: false });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb", display: "swap", preload: false });

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
  return (
    <html lang={locale} className={`${noto.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans antialiased">
        <NextIntlClientProvider>
          <Header />
          <main className="mx-auto w-full max-w-[1200px] px-4 pb-28 pt-4 md:px-6 lg:pb-12">{children}</main>
          <BottomTabs />
          <LandingBeacon />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
