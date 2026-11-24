"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui";

function MfaForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") ?? "/";
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    try { await api("/api/auth/mfa", { method: "POST", json: { code } }); router.push(next.startsWith("/") ? next : "/"); router.refresh(); }
    catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }
  return (
    <div className="fade-up w-full max-w-sm rounded-xl border border-line bg-panel/90 p-7">
      <ShieldCheck className="size-8 text-accent-2" />
      <h1 className="mt-3 text-xl font-semibold">Two-factor verification</h1>
      <p className="mt-1 text-sm text-muted">Enter the 6-digit code from your authenticator app.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Input label="Code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
        {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>Verify</Button>
      </form>
    </div>
  );
}
export default function MfaPage() { return <Suspense><MfaForm /></Suspense>; }
