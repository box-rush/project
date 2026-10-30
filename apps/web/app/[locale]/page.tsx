import { getTranslations, setRequestLocale } from "next-intl/server";
import { activeBanners, listLotteries, recordEvent } from "@boxrush/services";
import { cookies } from "next/headers";
import { Link } from "@/i18n/routing";
import { getCtx } from "@/lib/ctx";
import { getSessionUser } from "@/lib/session";
import { LotteryCard } from "@/components/LotteryCard";

export const dynamic = "force-dynamic";
const CATS = ["ALL", "POKEMON", "ONEPIECE", "YUGIOH"] as const;
const SORTS = ["recommended", "opening", "remaining", "price"] as const;

/** U04 home (F3.1 tabs, F3.2 sort, F3.3 cards, F3.5 entry zone, F3.9 banners). */
export default async function Home({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<{ c?: string; sort?: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations();
  const ctx = getCtx();
  const cat = CATS.includes(sp.c as never) ? sp.c! : "ALL";
  const sort = SORTS.includes(sp.sort as never) ? (sp.sort as (typeof SORTS)[number]) : "recommended";
  const [list, banners, recent, user] = await Promise.all([
    listLotteries(ctx, { category: cat === "ALL" ? undefined : cat, sort }),
    activeBanners(ctx),
    listLotteries(ctx, { statuses: ["ATTRIBUTED", "FULFILLING", "COMPLETED"], limit: 4, sort: "opening" }),
    getSessionUser(),
  ]);
  const anon = (await cookies()).get("br_anon")?.value ?? null;
  await recordEvent(ctx.db, "view_home", { userId: user?.id ?? null, anonId: anon });
  const entry = list.filter((l) => l.status === "ON_SALE" && l.slotPrice <= 500);
  const qs = (o: Record<string, string>) => `/?${new URLSearchParams({ c: cat, sort, ...o }).toString()}`;

  return (
    <div className="space-y-6">
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 md:flex-wrap" role="tablist">
        {CATS.map((c) => (
          <Link key={c} href={qs({ c })} role="tab" aria-selected={c === cat} className={`chip min-h-9 px-4 text-sm whitespace-nowrap ${c === cat ? "border-primary bg-primary text-white" : ""}`}>
            {t(`category.${c}`)}
          </Link>
        ))}
      </div>

      {banners.length > 0 && (
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4">
          {banners.map((b) => (
            <Link key={b.id} href={b.href} className="card min-w-[85%] snap-start bg-gradient-to-r from-primary to-trust p-5 text-white md:min-w-[48%]">
              <div className="text-base font-bold">{b.title}</div>
            </Link>
          ))}
        </div>
      )}

      {entry.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">
            {t("home.entry")} <span className="text-xs font-normal text-ink-2">{t("home.entryNote")}</span>
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {entry.slice(0, 4).map((l) => (
              <LotteryCard key={l.id} l={l} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">{t("home.title")}</h2>
          <div className="flex gap-1 text-xs">
            {SORTS.map((s) => (
              <Link key={s} href={qs({ sort: s })} className={`chip ${s === sort ? "border-primary text-primary" : ""}`}>
                {t(`home.sort.${s}`)}
              </Link>
            ))}
          </div>
        </div>
        {list.length === 0 ? (
          <p className="text-ink-2">{t("home.noLotteries")}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {list.map((l) => (
              <LotteryCard key={l.id} l={l} />
            ))}
          </div>
        )}
      </section>

      {recent.length > 0 && (
        <section>
          <h2 className="mb-2 font-bold">{t("home.recent")}</h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {recent.map((l) => (
              <LotteryCard key={l.id} l={l} />
            ))}
          </div>
        </section>
      )}

      <section className="card p-4">
        <h2 className="mb-3 font-bold">{t("home.howTitle")}</h2>
        <ol className="grid gap-3 text-sm md:grid-cols-4">
          {(["how1", "how2", "how3", "how4"] as const).map((k, i) => (
            <li key={k} className="flex gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs text-white">{i + 1}</span>
              {t(`home.${k}`)}
            </li>
          ))}
        </ol>
        <Link href="/welcome" className="mt-3 inline-block text-sm text-primary underline">
          {t("welcome.title")}
        </Link>
      </section>
    </div>
  );
}
