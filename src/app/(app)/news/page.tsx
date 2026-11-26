"use client";
import { useState } from "react";
import { Newspaper, Search } from "lucide-react";
import { NewsFeed } from "@/components/NewsFeed";
import { Pills } from "@/components/ui";

export default function NewsPage() {
  const [cat, setCat] = useState<"" | "stocks" | "crypto">("");
  const [q, setQ] = useState("");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title"><Newspaper className="size-6 text-accent-2" /> Articles &amp; News</h1>
          <p className="mt-1 text-sm text-muted">The latest stock and crypto headlines. Tap one to read it, or press Teach Merod to have the AI learn from it.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search news or a ticker" className="h-9 w-56 rounded-xl border border-line bg-bg-2 pl-8 pr-3 text-sm outline-none focus:border-accent" />
          </div>
          <Pills value={cat} onChange={setCat} options={[{ value: "", label: "All" }, { value: "stocks", label: "Stocks" }, { value: "crypto", label: "Crypto" }]} />
        </div>
      </div>
      <NewsFeed category={cat} query={q} />
    </div>
  );
}
