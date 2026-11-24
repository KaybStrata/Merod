import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Server-side guard: only admins can load anything under /admin. APIs enforce requireAdmin() independently. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login?next=/admin");
  if (!s.mfaPassed) redirect("/login/mfa?next=/admin");
  if (s.role !== "admin" && s.role !== "super_admin") redirect("/");
  return <>{children}</>;
}
