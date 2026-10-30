import { H } from "./hash";

/** RANDOM mode participant line: `<publicId>#<purchase seq, 2 digits>`, ordered by payment confirmation (§10.4.1). */
export function randomLine(publicId: string, seq: number): string {
  return `${publicId}#${String(seq).padStart(2, "0")}`;
}

/** PICK mode participant line: `<slot no, 2 digits>:<publicId>`, ordered by slot number. */
export function pickLine(slotNumber: number, publicId: string): string {
  return `${String(slotNumber).padStart(2, "0")}:${publicId}`;
}

/** Lines joined with "\n", no trailing newline. */
export function participantsText(lines: readonly string[]): string {
  return lines.join("\n");
}

export function participantsHash(text: string): string {
  return H(text);
}
