"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { api } from "@/lib/api";
import { Button, Input } from "@/components/ui";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") && params.get("next")!.startsWith("/") ? params.get("next")! : "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null);
    try {
      const r = await api<{ mfaRequired: boolean }>("/api/auth/login", { method: "POST", json: { email, password } });
      router.push(r.mfaRequired ? `/login/mfa?next=${encodeURIComponent(next)}` : next);
      router.refresh();
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }

  return (
    <div className="fade-up w-full max-w-sm rounded-xl border border-line bg-panel/90 p-7">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-muted">Welcome back to Merod.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Input label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="rounded-lg bg-down-soft px-3 py-2 text-sm text-down">{error}</p>}
        <Button type="submit" variant="primary" size="lg" className="w-full" loading={loading}>Sign in</Button>
      </form>
      <p className="mt-5 text-center text-sm text-muted">New to Merod? <Link href="/signup" className="text-accent-2 hover:underline">Create an account</Link></p>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
