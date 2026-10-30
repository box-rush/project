"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { afterAuth } from "@/lib/actions/account";
import { Link, useRouter } from "@/i18n/routing";
import { ErrorText } from "@/components/ErrorText";

export function LoginForm({ mode, next, providers }: { mode: "login" | "signup"; next: string; providers: readonly ("google" | "apple" | "line")[] }) {
  const t = useTranslations("auth");
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = async () => {
    const r = await afterAuth();
    if (r.ok && r.data.needsPhone) return router.push(`/verify-phone?next=${encodeURIComponent(next)}`);
    if (r.ok && r.data.needsOnboarding) return router.push(`/welcome?next=${encodeURIComponent(next)}`);
    router.push(next);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setErr(null);
          const res = mode === "signup" ? await authClient.signUp.email({ email, password, name: name || email.split("@")[0]! }) : await authClient.signIn.email({ email, password });
          setBusy(false);
          if (res.error) return setErr(mode === "signup" ? "VALIDATION" : "AUTH_FAILED");
          await done();
        }}
      >
        {mode === "signup" && (
          <label className="block text-sm">
            {t("name")}
            <input className="input mt-1" value={name} onChange={(e) => setName(e.target.value)} autoComplete="nickname" />
          </label>
        )}
        <label className="block text-sm">
          {t("email")}
          <input className="input mt-1" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </label>
        <label className="block text-sm">
          {t("password")}
          <input className="input mt-1" type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === "signup" ? "new-password" : "current-password"} />
        </label>
        {mode === "signup" && <p className="text-xs text-ink-2">{t("termsAgree")}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {mode === "signup" ? t("signup") : t("login")}
        </button>
        <ErrorText code={err} />
      </form>
      {providers.length > 0 && (
        <>
          <div className="text-center text-xs text-ink-2">{t("or")}</div>
          {providers.map((p) => (
            <button key={p} className="btn btn-ghost w-full" onClick={() => authClient.signIn.social({ provider: p, callbackURL: `/verify-phone?next=${encodeURIComponent(next)}` })}>
              {t(p)}
            </button>
          ))}
        </>
      )}
      <p className="text-center text-sm">
        {mode === "signup" ? (
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="text-primary underline">
            {t("haveAccount")}
          </Link>
        ) : (
          <Link href={`/login?mode=signup&next=${encodeURIComponent(next)}`} className="text-primary underline">
            {t("noAccount")}
          </Link>
        )}
      </p>
    </div>
  );
}
