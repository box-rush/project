import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/routing";
import { getSessionUser } from "@/lib/session";
import { getCtx } from "@/lib/ctx";
import { unreadCount } from "@boxrush/services";

const TABS = [
  { href: "/", key: "home", icon: "⌂" },
  { href: "/live", key: "live", icon: "◉" },
  { href: "/my-slots", key: "mySlots", icon: "▤" },
  { href: "/collection", key: "collection", icon: "▣" },
  { href: "/mypage", key: "myPage", icon: "◯" },
] as const;

export async function Header() {
  const t = await getTranslations("nav");
  const tb = await getTranslations("brand");
  const user = await getSessionUser();
  const unread = user ? await unreadCount(getCtx().db, user.id) : 0;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center gap-4 px-4 md:px-6">
        <Link href="/" className="text-lg font-black tracking-tight text-primary">
          {tb("name")}
        </Link>
        <nav className="ml-6 hidden gap-5 text-sm lg:flex">
          {TABS.slice(0, 4).map((x) => (
            <Link key={x.key} href={x.href} className={`hover:text-primary ${x.key === "live" ? "opacity-40" : ""}`}>
              {t(x.key)}
            </Link>
          ))}
          <Link href="/verify" className="hover:text-primary">
            {t("verify")}
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3 text-sm">
          {user ? (
            <>
              <Link href="/notifications" className="relative" aria-label="notifications">
                🔔{unread > 0 && <span className="absolute -right-2 -top-1 rounded-full bg-error px-1 text-[10px] text-white">{unread}</span>}
              </Link>
              <Link href="/mypage" className="hidden lg:inline">
                {user.name}
              </Link>
            </>
          ) : (
            <Link href="/login" className="btn btn-ghost min-h-9 px-3">
              {t("login")}
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

export async function BottomTabs() {
  const t = await getTranslations("nav");
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface lg:hidden" aria-label="tabs">
      <ul className="mx-auto grid max-w-[768px] grid-cols-5">
        {TABS.map((x) => (
          <li key={x.key}>
            {/* §10.5: LIVE (M7 live, P1) is shown greyed out in the MVP */}
            <Link href={x.href} className={`flex h-14 flex-col items-center justify-center text-[11px] ${x.key === "live" ? "opacity-40" : ""}`} aria-disabled={x.key === "live"}>
              <span aria-hidden className="text-lg leading-none">
                {x.icon}
              </span>
              {t(x.key)}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
