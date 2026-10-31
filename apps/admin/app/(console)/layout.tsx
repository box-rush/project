import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { LocaleSwitcher } from "@/components/LocaleSwitcher";
import { SideNav } from "@/components/SideNav";
import { navFor } from "@/lib/nav";
import { requireStaff } from "@/lib/session";
import { logoutAction } from "../login/actions";

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const staff = await requireStaff();
  const t = await getTranslations("shell");
  const tr = await getTranslations("roles");
  const tn = await getTranslations("nav");
  const sections = navFor(staff.roles).map((s) => ({
    key: s.key,
    label: tn(`section.${s.key}`),
    items: s.items.map((i) => ({ href: i.href, code: i.key, label: tn(`item.${i.labelKey ?? i.key}`) })),
  }));
  return (
    <div className="grid min-h-screen grid-cols-[232px_1fr]">
      <aside className="sticky top-0 h-screen overflow-y-auto border-r border-line bg-surface px-3 py-4">
        <div className="mb-4 px-2">
          <div className="text-base font-black">{t("brand")}</div>
          <div className="text-xs text-ink2">{t("console")}</div>
        </div>
        <SideNav sections={sections} />
      </aside>
      <div className="min-w-0">
        <header className="flex items-center gap-3 border-b border-line bg-surface px-6 py-2">
          <div className="text-sm">
            <span className="font-semibold">{staff.name}</span> <span className="mono text-xs text-ink2">{staff.email}</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {staff.roles.map((r) => (
              <span key={r} className="badge text-[11px]">
                {tr(r)}
              </span>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-4">
            <LocaleSwitcher />
            <form action={logoutAction}>
              <button className="btn !min-h-7 text-xs">{t("logout")}</button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-[1280px] px-6 py-5">{children}</main>
      </div>
    </div>
  );
}
