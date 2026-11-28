"use client";
import { ScopePnlCard } from "@/components/ScopePnl";

/** Auton's own P&L (only bots/AI bots Auton made or manages): pick a range; it's compared with the period before. */
export function AutonPnlCard({ className }: { className?: string }) {
  return <ScopePnlCard scope="auton" title="Auton" className={className} />;
}
