"use client";
import { useActionState, type ReactNode } from "react";
import type { ActionResult } from "@/lib/result";
import { ResultMessage } from "./ResultMessage";

type Action = (prev: ActionResult<unknown> | null, fd: FormData) => Promise<ActionResult<unknown>>;

/** A form bound to a server action; shows the translated outcome under the submit button. */
export function ActionForm({
  action,
  children,
  submitLabel,
  submitClass = "btn btn-primary",
  className = "",
  confirmText,
  inline = false,
}: {
  action: Action;
  children?: ReactNode;
  submitLabel: string;
  submitClass?: string;
  className?: string;
  confirmText?: string;
  inline?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirmText && !window.confirm(confirmText)) e.preventDefault();
      }}
    >
      <div className={inline ? "flex flex-wrap items-end gap-2" : "flex flex-col gap-3"}>
        {children}
        <div className="flex items-center gap-3">
          <button type="submit" className={submitClass} disabled={pending}>
            {submitLabel}
          </button>
        </div>
      </div>
      <div className="mt-1">
        <ResultMessage result={state} />
      </div>
    </form>
  );
}
