import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { Shell } from "@/components/shell/Shell";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.mfaPassed) redirect("/login/mfa");
  return (
    <Shell user={{ id: s.id, handle: s.handle, displayName: s.displayName, role: s.role, tradingMode: s.tradingMode, totpEnabled: s.totpEnabled }}>
      {children}
    </Shell>
  );
}
