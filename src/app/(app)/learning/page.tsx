"use client";
import Link from "next/link";
import { Brain, GraduationCap, Radio } from "lucide-react";
import { LearningFeed } from "@/components/LearningFeed";
import { TeachMerod } from "@/components/TeachMerod";
import { Card } from "@/components/ui";

export default function LearningPage() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold"><Brain className="size-6 text-accent-2" /> AI Learning</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted">What Merod has learned from your trades, bots, shortcuts and the material you teach it — updated live. Press <b className="text-text">Update</b> to apply a learning to your account.</p>
        </div>
        <div className="flex gap-2 text-sm">
          <Link href="/activity" className="flex items-center gap-1.5 rounded-xl border border-line bg-panel-2 px-3 py-2 hover:border-line-2"><Radio className="size-4" /> Live activity</Link>
          <Link href="/training" className="flex items-center gap-1.5 rounded-xl border border-line bg-panel-2 px-3 py-2 hover:border-line-2"><GraduationCap className="size-4" /> Auto-training</Link>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_380px]">
        <LearningFeed />
        <div className="space-y-4">
        <TeachMerod />
        <Card title="How learning works">
          <ol className="list-decimal space-y-2 pl-4 text-sm text-muted">
            <li>Every 2 minutes Merod reviews closed trades, rejected orders and bot cycles.</li>
            <li>It looks for patterns: which methods and assets lose money, recurring execution problems, timing, and better bot settings found by replaying recent prices.</li>
            <li>Each learning shows its evidence, sample size and confidence.</li>
            <li><b className="text-text">Update</b> applies the proposed change (bot settings, prompt defaults, shortcut sizes or tighter risk limits). Nothing changes until you press it.</li>
            <li>Every update is logged in Auto-Training history and can be reverted.</li>
          </ol>
          <p className="mt-3 text-xs text-faint">Auto-training makes small risk-reducing corrections automatically; AI Learning proposes bigger changes for you to approve.</p>
        </Card>
        </div>
      </div>
    </div>
  );
}
