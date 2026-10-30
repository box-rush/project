import { getTranslations, setRequestLocale } from "next-intl/server";
import { PageTitle, Section, Notice } from "@/components/ui";

export const dynamic = "force-static";

const SPEC = `H(x)  = SHA-256(UTF-8 bytes of x) → lowercase hex

① commit            = H(server_seed)                      // published before sale
② participants_text = "<publicId>#<seq 2 digits>" lines, "\\n" joined, no trailing newline (payment order)
   participants_hash = H(participants_text)              // fixed when the lottery fills
③ final             = H(server_seed + "|" + participants_hash + "|" + beacon)   // beacon = "" in this release
④ arr = [0..m-1]  (m = number of card numbers in the frozen checklist, official order)
   for i = m-1 down to 1:
       j = int(H(final + ":" + i)[0:8], 16) mod (i + 1)
       swap arr[i], arr[j]
   shuffled[k] = checklist[arr[k]]
   card number shuffled[k] → participant line (k mod n)
⑤ server_seed and every input/output are published`;

/** V03 algorithm description and script download (F8.4). */
export default async function AlgorithmPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("verify");
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageTitle>{t("algoTitle")}</PageTitle>
      <Notice>{t("scopeNote")}</Notice>
      <Section title={t("algorithm")}>
        <pre className="overflow-auto rounded bg-line/40 p-3 font-mono text-xs leading-relaxed">{SPEC}</pre>
      </Section>
      <a href="/bx_shuffle_v1.py" download className="btn btn-primary">
        {t("script")}
      </a>
    </div>
  );
}
