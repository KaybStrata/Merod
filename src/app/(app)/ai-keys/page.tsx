"use client";
import { useState } from "react";
import { Sparkles, CheckCircle2, Circle, ExternalLink } from "lucide-react";
import { api, useApi } from "@/lib/api";
import { UserApiKeys } from "@/components/UserApiKeys";
import { Badge, Card, cx, useToast } from "@/components/ui";

const BRANDS = {
  anthropic: {
    title: "Claude",
    by: "by Anthropic",
    blurb: "Includes Claude Opus (most thorough), Sonnet (balanced), Haiku (fastest) and Fable.",
    getKey: "https://platform.claude.com/settings/keys",
    swatch: "bg-[#d97757]",
  },
  openai: {
    title: "ChatGPT",
    by: "by OpenAI",
    blurb: "Uses OpenAI's GPT models, the same family behind ChatGPT.",
    getKey: "https://platform.openai.com/api-keys",
    swatch: "bg-[#10a37f]",
  },
} as const;

/** Paste your own Claude (incl. Opus) or ChatGPT key, then pick which model reads your prompts. */
export default function AIKeysPage() {
  const models = useApi<any>("/api/ai/models");
  const [saving, setSaving] = useState<string | null>(null);
  const toast = useToast();
  const pref = models.data?.preference;

  async function choose(provider: string, model: string) {
    setSaving(model);
    try { await api("/api/ai/preferences", { method: "PUT", json: { provider, model } }); toast("Your prompts now use this model", "up"); models.refresh(); }
    catch (e: any) { toast(e.message, "down"); } finally { setSaving(null); }
  }

  const providers: any[] = (models.data?.providers ?? []).filter((p: any) => p.id in BRANDS);
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Sparkles className="size-6 text-accent-2" /> AI Keys</h1>
        <p className="mt-1 text-sm text-muted">Paste your own Claude or ChatGPT API key, then choose which model reads your prompts. Your key is encrypted and used only for your own prompts.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {(["anthropic", "openai"] as const).map((id) => {
          const b = BRANDS[id];
          const p = providers.find((x) => x.id === id);
          return (
            <div key={id} className="space-y-3">
              <Card>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={cx("flex size-10 items-center justify-center rounded-xl text-lg font-bold text-white", b.swatch)}>{b.title[0]}</span>
                    <div>
                      <div className="text-base font-semibold">{b.title} <span className="text-xs font-normal text-faint">{b.by}</span></div>
                      <div className="text-xs text-muted">{b.blurb}</div>
                    </div>
                  </div>
                  {p?.ownKey ? <Badge tone="up">Your key · connected</Badge> : p?.connected ? <Badge tone="info">Using Merod&apos;s key</Badge> : <Badge>Not connected</Badge>}
                </div>
                <a href={b.getKey} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs text-accent-2">Get a {b.title} API key <ExternalLink className="size-3" /></a>

                <div className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Model for my prompts</div>
                <div className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                  {(p?.models ?? []).map((m: any) => {
                    const active = pref?.provider === id && pref?.model === m.id;
                    return (
                      <button key={m.id} onClick={() => choose(id, m.id)} disabled={!!saving || !p?.connected}
                        title={!p?.connected ? `Paste and test a ${b.title} key first` : undefined}
                        className={cx("flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                          active ? "border-accent bg-accent-soft text-text" : "border-line bg-panel-2 text-muted hover:border-line-2 hover:text-text")}>
                        {active ? <CheckCircle2 className="size-4 shrink-0 text-accent-2" /> : <Circle className="size-4 shrink-0" />}
                        <span className="truncate">{m.label}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
              <UserApiKeys providers={[id]} title={`Paste your ${b.title} API key`} onChange={models.refresh} />
            </div>
          );
        })}
      </div>

      <Card>
        <div className="text-xs text-muted">
          <span className="font-medium text-text">How it works:</span> paste your key and press <b>Save</b>, then <b>Test</b>. Once it shows connected, pick a model above. Your prompts in the prompt box then go to that model using your key, and you pay that company directly for usage. Without a key, Merod uses its own connected key if an admin has added one; otherwise it uses its built-in rule reader. The AI only turns your words into a trade plan. Every trade still goes through your limits and confirmations.
        </div>
      </Card>
    </div>
  );
}
