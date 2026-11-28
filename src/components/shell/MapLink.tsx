"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Map as MapIcon } from "lucide-react";
import { cx } from "@/components/ui";

/** Top-bar "Map" button: the canvas for wiring bots, agents, prompts, skills and points into methods. */
export function MapLink({ onOpen }: { onOpen?: () => void } = {}) {
  const on = usePathname()?.startsWith("/map");
  if (onOpen) return (
    <button onClick={onOpen} title="Map: organize and connect bots, agents, prompts, skills and points (floating window)"
      className="flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12.5px] font-medium text-muted hover:border-line-2 hover:text-text">
      <MapIcon className="size-3.5" /><span className="hidden sm:inline">Map</span>
    </button>
  );
  return (
    <Link href="/map" title="Map: organize and connect bots, agents, prompts, skills and points"
      className={cx("flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium", on ? "border-accent/60 bg-accent/15 text-text" : "border-line text-muted hover:border-line-2 hover:text-text")}>
      <MapIcon className="size-3.5" /><span className="hidden sm:inline">Map</span>
    </Link>
  );
}
