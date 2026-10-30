"use client";
import { authClient } from "@/lib/auth-client";
import { usePathname, useRouter } from "@/i18n/routing";
import { savePrefs } from "@/lib/actions/account";

export function LogoutButton({ label }: { label: string }) {
  const router = useRouter();
  return (
    <button
      className="btn btn-ghost w-full"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}

const NAMES: Record<string, string> = { ja: "日本語", "zh-Hans": "简体中文", en: "English" }; // lint-ur:allow (language names are shown in their own language)

export function LocaleSwitcher({ current, locales }: { current: string; locales: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      className="input w-auto"
      value={current}
      onChange={async (e) => {
        const locale = e.target.value as "ja" | "zh-Hans" | "en";
        await savePrefs({ locale });
        router.replace(pathname, { locale });
      }}
    >
      {locales.map((l) => (
        <option key={l} value={l}>
          {NAMES[l] ?? l}
        </option>
      ))}
    </select>
  );
}
