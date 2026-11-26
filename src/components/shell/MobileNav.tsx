"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, BarChart3, MessagesSquare, Activity, Settings } from "lucide-react";
import { cx } from "@/components/ui";

const TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Markets", icon: BarChart3 },
  { href: "/ai", label: "Ask Merod", icon: MessagesSquare, center: true },
  { href: "/live", label: "Activity", icon: Activity, also: ["/activity"] },
  { href: "/settings", label: "Settings", icon: Settings, also: ["/broker-keys", "/ai-keys"] },
];

/** Bottom tab bar for phones and tablets (hidden on desktop, where the sidebar is shown). */
export function MobileNav() {
  const pathname = usePathname();
  const on = (t: (typeof TABS)[number]) => t.href === "/" ? pathname === "/" : pathname === t.href || pathname.startsWith(t.href + "/") || !!t.also?.some((a) => pathname.startsWith(a));
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg-2/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
      <ul className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
        {TABS.map((t) => {
          const active = on(t);
          return (
            <li key={t.href} className="flex justify-center">
              <Link href={t.href} aria-current={active ? "page" : undefined}
                className={cx("flex flex-col items-center gap-0.5 rounded-xl px-2 py-1 text-[10px] font-medium", active ? "text-accent-2" : "text-muted")}>
                {t.center
                  ? <span className={cx("-mt-5 flex size-11 items-center justify-center rounded-full bg-grad shadow-lg", active && "ring-2 ring-accent/50")}><t.icon className="size-5" /></span>
                  : <t.icon className="size-5" strokeWidth={1.7} />}
                <span>{t.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
