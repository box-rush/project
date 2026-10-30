import { getTranslations, setRequestLocale } from "next-intl/server";
import { requireUser } from "@/lib/guard";
import { Link } from "@/i18n/routing";
import { Notice, PageTitle } from "@/components/ui";
import { LogoutButton, LocaleSwitcher } from "./client";
import { routing } from "@/i18n/routing";

export const dynamic = "force-dynamic";
const LINKS = [
  ["orders", "/orders"],
  ["limits", "/limits"],
  ["addresses", "/addresses"],
  ["payments", "/payment-methods"],
  ["coupons", "/coupons"],
  ["notifications", "/notifications"],
  ["help", "/help"],
  ["support", "/support"],
  ["legal", "/legal"],
  ["delete", "/delete-account"],
] as const;

/** U26 マイページ. */
export default async function MyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const user = await requireUser("/mypage");
  const t = await getTranslations("myPage");
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageTitle>{t("title")}</PageTitle>
      <div className="card space-y-1 p-4 text-sm">
        <div className="font-bold">{user.name}</div>
        <div className="text-ink-2">{user.email}</div>
        <div>
          {t("phone")}: {user.phoneNumberVerified ? <span className="text-trust">✓ {t("phoneVerified")}</span> : <Link href="/verify-phone" className="text-warning underline">{t("phoneNotVerified")}</Link>}
        </div>
      </div>
      {user.purchaseSuspendedReason && <Notice tone="warning">{t("suspended", { reason: t(`suspendReason.${user.purchaseSuspendedReason}` as never) })}</Notice>}
      <ul className="card divide-y divide-line">
        {LINKS.map(([k, href]) => (
          <li key={k}>
            <Link href={href} className="flex min-h-12 items-center justify-between px-4 text-sm">
              {t(k)} <span aria-hidden>›</span>
            </Link>
          </li>
        ))}
      </ul>
      {routing.locales.length > 1 && (
        <div className="card flex items-center justify-between p-4 text-sm">
          <span>{t("language")}</span>
          <LocaleSwitcher current={locale} locales={[...routing.locales]} />
        </div>
      )}
      <LogoutButton label={t("logout")} />
    </div>
  );
}
