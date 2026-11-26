import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";
import { Shell } from "@/components/shell/Shell";

export const dynamic = "force-dynamic";

/**
 * Talk mode no-flash script (only when NEXT_PUBLIC_MEROD_TALK_MODE=1, and only for signed-in users): if Merod should open in
 * Talk (localStorage["merod-mode"], written from Settings › Interface), go from Home straight to /talk once per browser session,
 * before Home paints. Deep links to classic pages are never redirected.
 */
const modeScript = `try{var m=localStorage.getItem('merod-mode')||'classic';document.documentElement.dataset.mode=m;if(m==='talk'&&location.pathname==='/'&&!sessionStorage.getItem('merod-talk-redirected')){sessionStorage.setItem('merod-talk-redirected','1');location.replace('/talk');}}catch(e){}`;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.mfaPassed) redirect("/login/mfa");
  return (
    <>
      {process.env.NEXT_PUBLIC_MEROD_TALK_MODE === "1" && <script dangerouslySetInnerHTML={{ __html: modeScript }} />}
      <Shell user={{ id: s.id, handle: s.handle, displayName: s.displayName, role: s.role, tradingMode: s.tradingMode, totpEnabled: s.totpEnabled }}>
        {children}
      </Shell>
    </>
  );
}
