"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui";

export default function SignupPage() {
  const router = useRouter();
  const [f, setF] = useState({ email: "", password: "", handle: "", displayName: "", acceptTerms: false, setupCode: "" });
  const [needsCode, setNeedsCode] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: k === "acceptTerms" ? e.target.checked : e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setLoading(true); setError(null);
    try {
      const r = await api<{ role: string }>("/api/auth/signup", { method: "POST", json: { ...f, setupCode: f.setupCode || undefined } });
      // Owner/super admin: go straight to two-factor setup.
      router.push(r.role === "super_admin" ? "/settings?tab=security" : "/"); router.refresh();
    } catch (e: any) {
      if (e.body?.code === "setup_code_required") setNeedsCode(true);
      setError(e.body?.issues?.[0]?.message ?? e.message);
    } finally { setLoading(false); }
  }

  return (
    <div className="fade-up w-full max-w-md rounded-xl border border-line bg-panel/90 p-7">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-muted">Start with $100,000 in virtual funds. Paper trading only — no real money.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Input label="Display name" required value={f.displayName} onChange={set("displayName")} />
          <Input label="Handle" required placeholder="your_handle" value={f.handle} onChange={set("handle")} hint="3–20 letters, numbers, _" />
        </div>
        <Input label="Email" type="email" autoComplete="email" required value={f.email} onChange={set("email")} />
        <Input label="Password" type="password" autoComplete="new-password" required minLength={10} value={f.password} onChange={set("password")} hint="At least 10 characters" />
        {needsCode && (
          <Input label="Owner setup code" type="password" autoComplete="off" required value={f.setupCode} onChange={set("setupCode")}
            hint="This email is reserved for the platform owner. Enter the SUPER_ADMIN_SETUP_CODE configured on the server." />
        )}
        <label className="flex items-start gap-2 text-xs text-muted">
          <input type="checkbox" className="mt-0.5 accent-[var(--accent)]" checked={f.acceptTerms} onChange={set("acceptTerms")} />
          <span>I understand that trading involves risk, that paper trading results are simulated, and that Merod does not provide financial advice.</span>
        </label>
        {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading} disabled={!f.acceptTerms}>Create account</Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">Already have an account? <Link href="/login" className="text-accent-2 hover:underline">Sign in</Link></p>
    </div>
  );
}
