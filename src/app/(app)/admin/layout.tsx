import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { AdminTabs } from "./AdminTabs";

export const dynamic = "force-dynamic";

/** Server-side guard: only admins can load anything under /admin. APIs enforce requireAdmin() independently. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login?next=/admin");
  if (!s.mfaPassed) redirect("/login/mfa?next=/admin");
  if (s.role !== "admin" && s.role !== "super_admin") redirect("/");
  return <div className="space-y-4"><AdminTabs superAdmin={s.role === "super_admin"} />{children}</div>;
}
