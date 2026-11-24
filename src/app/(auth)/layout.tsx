import Link from "next/link";
import { Logo } from "@/components/shell/Logo";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-glow flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-6 py-5">
        <Link href="/"><Logo /></Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pb-16">{children}</main>
      <footer className="px-6 pb-6 text-center text-[11px] text-faint">
        Trading involves risk of loss. Merod runs in paper-trading mode with virtual funds until live trading is approved. Not financial advice.
      </footer>
    </div>
  );
}
