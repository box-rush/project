"use client";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { finishOnboarding } from "@/lib/actions/account";

export function WelcomeStart({ loggedIn, next }: { loggedIn: boolean; next: string }) {
  const t = useTranslations("welcome");
  const router = useRouter();
  return (
    <button
      className="btn btn-primary w-full"
      onClick={async () => {
        if (loggedIn) await finishOnboarding();
        router.push(next);
      }}
    >
      {t("start")}
    </button>
  );
}
