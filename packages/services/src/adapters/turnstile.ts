/**
 * T18 human verification before slots are taken (Cloudflare Turnstile — free, usually invisible to people).
 * Off when TURNSTILE_SECRET_KEY is unset (local, tests); in production the secret is required.
 * https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
 */
type Fetch = typeof fetch;

export function turnstileEnabled() {
  const s = process.env.TURNSTILE_SECRET_KEY;
  return !!s && s !== "unset";
}

export async function verifyTurnstile(token: string | null | undefined, ip: string | null, fetchImpl: Fetch = fetch): Promise<boolean> {
  if (!turnstileEnabled()) return true;
  if (!token || token.length > 2048) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token });
  if (ip) body.set("remoteip", ip);
  try {
    const res = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body, signal: AbortSignal.timeout(5_000) });
    const r = (await res.json()) as { success?: boolean; action?: string };
    return r.success === true && (r.action === undefined || r.action === "hold");
  } catch {
    // fail closed: an unverifiable request does not get to lock slots; the user can retry
    return false;
  }
}
