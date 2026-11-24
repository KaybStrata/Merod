"use client";
import { Badge } from "@/components/ui";

export function TradabilityBadge({ a }: { a: any }) {
  if (a.risk_flags?.includes("demo_data")) return <Badge tone="warn" title="Demo data — paper only">Demo · paper</Badge>;
  const t = a.tradability as string;
  const map: Record<string, [any, string, string]> = {
    discoverable: ["neutral", "Discoverable", "Listed for research; not yet tradable"],
    view_only: ["neutral", "View only", "No supported execution provider"],
    paper_tradable: ["accent", "Paper", "Tradable with virtual funds. Live trading requires a connected provider and approval."],
    live_tradable: ["up", "Live", "Live tradable"],
    restricted: ["down", "Restricted", "Restricted by compliance controls"],
    unsupported: ["down", "Unsupported", "Not supported"],
  };
  const [tone, label, title] = map[t] ?? ["neutral", t, t];
  return <Badge tone={tone} title={title}>{label}</Badge>;
}
