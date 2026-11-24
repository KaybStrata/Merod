"use client";
import Link from "next/link";
import { useState } from "react";
import { Newspaper, ExternalLink, GraduationCap, Loader2 } from "lucide-react";
import { useApi } from "@/lib/api";
import { Badge, Card, Empty, cx, useToast } from "@/components/ui";
import { ago } from "@/lib/format";

/** Headlines from public publisher feeds. Each links to the original; "Teach Merod" adds it to AI Learning. */
export function NewsFeed({ category, query, compact = false }: { category?: "" | "stocks" | "crypto"; query?: string; compact?: boolean }) {
  const params = new URLSearchParams({ limit: compact ? "20" : "80" });
  if (category) params.set("category", category);
  if (query?.trim()) params.set("q", query.trim());
  const { data, loading } = useApi<any>(`/api/news?${params}`, { refreshMs: 120_000 });
  const toast = useToast();
  const [teaching, setTeaching] = useState<string | null>(null);

  async function teach(url: string, id: string) {
    setTeaching(id);
    try {
      const fd = new FormData(); fd.append("url", url);
      const res = await fetch("/api/learning/materials", { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Couldn't add it");
      toast("Added to AI Learning. Merod is reading it now.", "up");
    } catch (e: any) { toast(e.message, "down"); } finally { setTeaching(null); }
  }

  const items: any[] = data?.items ?? [];
  return (
    <Card pad={false}>
      {!data ? <div className="flex items-center gap-2 p-4 text-sm text-muted"><Loader2 className="size-4 animate-spin" /> Loading the latest articles…</div>
        : items.length === 0 ? <div className="p-4"><Empty icon={<Newspaper className="size-6" />} title="No articles found">{query ? "Try a different search." : "News feeds are temporarily unavailable. Try again in a minute."}</Empty></div> : (
        <ul className="divide-y divide-line">
          {items.map((a) => (
            <li key={a.id} className="flex gap-3 px-4 py-3 hover:bg-panel-2/40">
              {a.image && !compact && <img src={a.image} alt="" loading="lazy" referrerPolicy="no-referrer" className="hidden h-16 w-24 shrink-0 rounded-lg border border-line object-cover sm:block" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
                  <span className="font-medium text-muted">{a.source}</span>
                  <Badge tone={a.category === "crypto" ? "accent" : "info"}>{a.category}</Badge>
                  {a.publishedAt && <span>{ago(a.publishedAt)}</span>}
                  {a.symbols.map((s: string) => <Link key={s} href={`/discover?q=${encodeURIComponent(s)}`} className="rounded bg-panel-2 px-1.5 py-0.5 font-medium text-text hover:text-accent-2">{s}</Link>)}
                </div>
                <a href={a.url} target="_blank" rel="noreferrer noopener" className="mt-0.5 block text-sm font-semibold leading-snug hover:text-accent-2">{a.title}</a>
                {a.summary && !compact && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{a.summary}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <a href={a.url} target="_blank" rel="noreferrer noopener" className="rounded-md p-1 text-muted hover:text-text" title="Read on the publisher's site"><ExternalLink className="size-4" /></a>
                <button onClick={() => teach(a.url, a.id)} disabled={teaching === a.id} className={cx("flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 text-[10px] text-muted hover:border-accent/50 hover:text-text disabled:opacity-50")} title="Add this article to AI Learning so Merod learns from it">
                  {teaching === a.id ? <Loader2 className="size-3 animate-spin" /> : <GraduationCap className="size-3" />} Teach Merod
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data?.sources && <p className="border-t border-line px-4 py-2 text-[10px] text-faint">Headlines from {data.sources.filter((s: any) => s.ok).map((s: any) => s.source).join(", ") || "public news feeds"}. Articles open on the publisher's site. Not financial advice.{loading ? " Refreshing…" : ""}</p>}
    </Card>
  );
}
