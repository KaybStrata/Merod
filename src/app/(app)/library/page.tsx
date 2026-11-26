"use client";
import Link from "next/link";
import { Bookmark, Layers, Database, Store, Bot, Zap } from "lucide-react";
import { useApi } from "@/lib/api";
import { ago } from "@/lib/format";
import { GoldWaves } from "@/components/ui/GoldWaves";
import { PageHead } from "@/components/agents/common";

/** Library: saved strategies, agent collections, the knowledge vault, templates, bots and shortcuts in one place. */
export default function Library() {
  const strategies = useApi<any>("/api/strategies");
  const fleets = useApi<any>("/api/agents/fleets");
  const kb = useApi<any>("/api/agents/knowledge");
  const mk = useApi<any>("/api/agents/marketplace");
  const collections = (fleets.data?.fleets ?? []).filter((f: any) => f.is_collection);
  const mine = (mk.data?.listings ?? []).filter((l: any) => l.own);
  return (
    <div className="relative">
      <GoldWaves className="-top-16 right-0 h-[220px] w-[60%] opacity-70" />
      <PageHead eyebrow="Merod Vault" title="Your" accent="Library" sub="Strategies, saved fleets, published templates and everything your agents have learned." />
      <div className="relative z-10 grid gap-4 lg:grid-cols-2">
        <Box icon={Layers} title="Strategies" link="/strategies" linkText="Strategy Builder">
          {(strategies.data?.strategies ?? []).slice(0, 8).map((s: any) => <Row key={s.id} title={s.name} sub={`v${s.latest_version ?? s.version ?? 1} · ${s.summary ?? ""}`} href="/strategies" />)}
          {!(strategies.data?.strategies ?? []).length && <Muted>No saved strategies yet.</Muted>}
        </Box>
        <Box icon={Bookmark} title="Agent collections" link="/agents/fleets" linkText="Fleet Builder">
          {collections.map((f: any) => <Row key={f.id} title={f.name} sub={`${f.agents} agents · ${f.operation_mode}`} href={`/agents/fleets/${f.id}`} />)}
          {!collections.length && <Muted>Save a fleet as a collection to reuse it as a complete trading system.</Muted>}
        </Box>
        <Box icon={Database} title="Knowledge vault" link="/agents/rooms" linkText="Rooms">
          {(kb.data?.knowledge ?? []).slice(0, 10).map((k: any) => <Row key={k.id} title={k.topic} sub={`${k.body.slice(0, 90)} · ${k.agent_name ?? "you"} · ${ago(k.created_at)}`} href={k.source?.startsWith("http") ? k.source : "/agents/rooms"} />)}
          {!(kb.data?.knowledge ?? []).length && <Muted>Agents that are allowed to share knowledge add findings here.</Muted>}
        </Box>
        <Box icon={Store} title="Published templates" link="/agents/marketplace" linkText="Marketplace">
          {mine.map((l: any) => <Row key={l.id} title={l.name} sub={`${l.visibility} · v${l.version} · ${l.installs} installs`} href="/agents/marketplace" />)}
          {!mine.length && <Muted>Publish an agent from its Settings tab to reuse or share it.</Muted>}
        </Box>
        <Box icon={Bot} title="Bots" link="/bots" linkText="Bots"><Muted>Rule-based bots and their logs.</Muted></Box>
        <Box icon={Zap} title="Shortcut buttons" link="/shortcuts" linkText="Shortcuts"><Muted>One-tap actions, including shortcuts made from approved agent instructions.</Muted></Box>
      </div>
    </div>
  );
}
function Box({ icon: I, title, link, linkText, children }: { icon: any; title: string; link: string; linkText: string; children: React.ReactNode }) {
  return <section className="surface rounded-2xl p-4"><header className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-2 text-[15px] font-semibold"><I className="size-4 text-accent-2" /> {title}</h3><Link href={link} className="text-xs text-muted hover:text-text">{linkText} →</Link></header><div className="space-y-0.5">{children}</div></section>;
}
function Row({ title, sub, href }: { title: string; sub: string; href: string }) {
  return <Link href={href} className="block rounded-lg px-2 py-1.5 hover:bg-panel-2"><div className="text-sm font-medium">{title}</div><div className="line-clamp-1 text-[11.5px] text-muted">{sub}</div></Link>;
}
function Muted({ children }: { children: React.ReactNode }) { return <p className="px-2 py-1 text-xs text-muted">{children}</p>; }
