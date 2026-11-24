"use client";
import { Gauge } from "lucide-react";
import { ProgressPanel } from "@/components/ProgressPanel";

export default function ProgressPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><Gauge className="size-6 text-accent-2" /> Progress</h1>
        <p className="mt-1 text-sm text-muted">Live progress of your own bots, prompts, shortcut buttons and trades.</p>
      </div>
      <ProgressPanel />
    </div>
  );
}
