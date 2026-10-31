"use client";

/**
 * Last-resort boundary: the root layout itself failed, so no translations are loaded. Plain Japanese, the language
 * every user of the public site reads (PD16).
 */
const TEXT = {
  title: "ページを表示できませんでした", // lint-ur:allow — no message catalog at this level
  body: "時間をおいてもう一度お試しください。", // lint-ur:allow
  retry: "再読み込み", // lint-ur:allow
};

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: "sans-serif", textAlign: "center", padding: "4rem 1rem" }}>
        <h1>{TEXT.title}</h1>
        <p>{TEXT.body}</p>
        {error.digest ? <p style={{ fontFamily: "monospace", fontSize: 12 }}>{error.digest}</p> : null}
        <button type="button" onClick={() => reset()}>
          {TEXT.retry}
        </button>
      </body>
    </html>
  );
}
