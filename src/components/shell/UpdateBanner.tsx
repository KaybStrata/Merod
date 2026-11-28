"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";

/** When a new version of Merod is deployed while a tab is open, offer a one-click reload (old tabs keep the old screens otherwise). */
export function UpdateBanner() {
  const first = useRef<string | null>(null);
  const [fresh, setFresh] = useState(false);
  useEffect(() => {
    let stop = false;
    const check = async () => {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok) return;
        const { version } = await r.json();
        if (!first.current) first.current = version;
        else if (version !== first.current && !stop) setFresh(true);
      } catch { /* offline: try later */ }
    };
    check();
    const t = setInterval(check, 60_000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => { stop = true; clearInterval(t); window.removeEventListener("focus", onFocus); };
  }, []);
  if (!fresh) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-3 rounded-full border border-accent/50 bg-panel px-4 py-2 text-[13px] shadow-2xl">
      <span>Merod was just updated with new features.</span>
      <button onClick={() => location.reload()} className="inline-flex items-center gap-1.5 rounded-full bg-grad px-3 py-1 text-[12.5px] font-semibold text-bg"><RefreshCw className="size-3.5" />Reload</button>
      <button onClick={() => setFresh(false)} className="text-faint hover:text-text" aria-label="Later">Later</button>
    </div>
  );
}
