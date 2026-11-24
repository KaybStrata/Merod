"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/components/ui";

/** Buttons that switch between the pages of one menu section (e.g. Bots | Shortcut buttons). */
export function SectionTabs({ tabs }: { tabs: { href: string; label: string; icon?: any }[] }) {
  const pathname = usePathname();
  return (
    <div className="flex w-full gap-1 rounded-xl border border-line bg-panel/80 p-1 sm:w-fit">
      {tabs.map((t) => {
        const active = pathname === t.href || pathname.startsWith(t.href + "/");
        return (
          <Link key={t.href} href={t.href}
            className={cx("flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none",
              active ? "bg-accent-soft text-text shadow-[inset_0_0_0_1px_rgba(56,189,248,.4)]" : "text-muted hover:bg-panel-2 hover:text-text")}>
            {t.icon && <t.icon className={cx("size-4", active && "text-accent-2")} />}{t.label}
          </Link>
        );
      })}
    </div>
  );
}
