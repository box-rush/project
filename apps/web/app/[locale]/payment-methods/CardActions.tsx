"use client";
import { useRouter } from "@/i18n/routing";
import { addTestCard, removeCard } from "@/lib/actions/account";

/** Production uses a Stripe SetupIntent + Payment Element; the mock adds a test card. */
export function CardActions({ removeId, label, addLabel }: { removeId?: string; label?: string; addLabel?: string }) {
  const router = useRouter();
  if (removeId)
    return (
      <button
        className="chip ml-auto"
        onClick={async () => {
          await removeCard(removeId);
          router.refresh();
        }}
      >
        {label}
      </button>
    );
  return (
    <button
      className="btn btn-ghost w-full"
      onClick={async () => {
        await addTestCard();
        router.refresh();
      }}
    >
      {addLabel}
    </button>
  );
}
