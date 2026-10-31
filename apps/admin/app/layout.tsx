import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const t = await getTranslations("app");
  return (
    <html lang={locale}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;600;700&family=Noto+Sans+JP:wght@400;500;700;900&display=swap"
        />
      </head>
      <body>
        {process.env.BOXRUSH_TEST_MODE === "1" && (
          <div role="status" data-testid="test-mode-banner" style={{ background: "#d98a00", color: "#000", textAlign: "center", fontSize: 12, padding: "2px 16px" }}>
            {t("testMode")}
          </div>
        )}
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
