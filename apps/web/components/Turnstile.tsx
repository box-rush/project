"use client";
import { useEffect, useRef } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

const SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/**
 * T18 human check (Cloudflare Turnstile) in front of taking slots. Usually invisible; a token is single-use, so the
 * parent calls `resetRef.current()` after every attempt. Renders nothing when no site key is configured.
 */
export function Turnstile({ siteKey, onToken, resetRef, locale }: { siteKey: string | null; onToken: (t: string | null) => void; resetRef: { current: () => void }; locale: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey || !box.current) return;
    let id: string | null = null;
    let cancelled = false;
    const mount = () => {
      if (cancelled || !window.turnstile || !box.current) return;
      id = window.turnstile.render(box.current, {
        sitekey: siteKey,
        action: "hold",
        language: locale,
        appearance: "interaction-only",
        callback: (t: string) => onToken(t),
        "expired-callback": () => onToken(null),
        "error-callback": () => onToken(null),
      });
      resetRef.current = () => {
        onToken(null);
        if (id) window.turnstile?.reset(id);
      };
    };
    if (window.turnstile) mount();
    else {
      let s = document.querySelector<HTMLScriptElement>(`script[src="${SRC}"]`);
      if (!s) {
        s = document.createElement("script");
        s.src = SRC;
        s.async = true;
        document.head.appendChild(s);
      }
      s.addEventListener("load", mount);
    }
    return () => {
      cancelled = true;
      if (id) window.turnstile?.remove(id);
    };
  }, [siteKey, onToken, resetRef, locale]);
  return siteKey ? <div ref={box} className="min-h-0" data-testid="turnstile" /> : null;
}
