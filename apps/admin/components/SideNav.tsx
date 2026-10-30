"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

interface Section {
  key: string;
  label: string;
  items: { href: string; code: string; label: string }[];
}

export function SideNav({ sections }: { sections: Section[] }) {
  const path = usePathname();
  const all = sections.flatMap((s) => s.items.map((i) => i.href));
  // longest matching prefix wins, so /merchant/lotteries/new does not also light up /merchant/lotteries
  const active = all.filter((h) => path === h || path.startsWith(`${h}/`)).sort((a, b) => b.length - a.length)[0];
  return (
    <nav className="flex flex-col gap-4">
      {sections.map((s) => (
        <div key={s.key}>
          <div className="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-ink2">{s.label}</div>
          <ul className="flex flex-col">
            {s.items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] ${active === i.href ? "bg-primary-soft font-bold text-primary" : "hover:bg-track"}`}
                >
                  <span className="mono w-8 text-[10px] text-ink2">{i.code}</span>
                  <span>{i.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
