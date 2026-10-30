"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";

type Item = { id: string; name: string; number: string | null; rarity: string; photo: string | null; from: string; freeUntil: string; frozen: boolean; pending: boolean; gold: boolean; guarantee: boolean };

export function ShipSelector({ items, selectable }: { items: Item[]; selectable: boolean }) {
  const t = useTranslations("collection");
  const router = useRouter();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setSel((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  return (
    <div className="space-y-3 pb-16">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        {items.map((i) => {
          const can = selectable && !i.frozen && !i.pending;
          return (
            <div key={i.id} className={`card overflow-hidden ${sel.has(i.id) ? "ring-2 ring-primary" : ""}`}>
              <Link href={`/collection/${i.id}`}>
                <div className="aspect-[5/7] bg-line/40">{i.photo && <img src={i.photo} alt="" className="h-full w-full object-cover" />}</div>
              </Link>
              <div className="space-y-1 p-2 text-xs">
                <div className="font-semibold">
                  {i.number && <span className="font-mono">{i.number} </span>}
                  {i.name}
                </div>
                <div className="flex gap-1">
                  <span className={`chip ${i.gold ? "border-gold text-gold font-bold" : ""}`}>{i.rarity}</span>
                  {i.guarantee && <span className="chip">{t("guarantee")}</span>}
                  {i.frozen && <span className="chip border-warning text-warning">{t("frozen")}</span>}
                </div>
                <div className="truncate text-ink-2">{i.from}</div>
                {selectable && <div className="num text-ink-2">{t("freeUntil", { at: i.freeUntil })}</div>}
                {can && (
                  <label className="flex min-h-9 items-center gap-2">
                    <input type="checkbox" checked={sel.has(i.id)} onChange={() => toggle(i.id)} />
                    {t("select")}
                  </label>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {selectable && sel.size > 0 && (
        <div className="fixed inset-x-0 bottom-14 z-20 border-t border-line bg-surface p-3 lg:bottom-0">
          <div className="mx-auto flex max-w-[1200px] items-center gap-3">
            <span className="text-sm">{t("selected", { n: sel.size })}</span>
            <button className="btn btn-primary ml-auto" onClick={() => router.push(`/collection/ship?items=${[...sel].join(",")}`)}>
              {t("ship")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
