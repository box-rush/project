import { redirect } from "next/navigation";
import { navFor } from "@/lib/nav";
import { requireStaff } from "@/lib/session";

export default async function Home() {
  const staff = await requireStaff();
  const first = navFor(staff.roles)[0]?.items[0];
  redirect(first ? first.href : "/forbidden");
}
