"use client";

/** Billing pages for each AI provider (where to add credits when the API says the account is out of credits). */
export const AI_BILLING = {
  openai: { label: "Add OpenAI credits", href: "https://platform.openai.com/settings/organization/billing/" },
  anthropic: { label: "Add Claude credits", href: "https://console.anthropic.com/settings/billing" },
} as const;

/** The AI fallback note, plus a direct link to the provider's credits page when the problem is billing. */
export function AiNote({ note, className }: { note: string | null; className?: string }) {
  if (!note) return null;
  const billing = /429|credit|quota|billing|insufficient/i.test(note);
  const which = /anthropic|claude/i.test(note) && !/openai|platform\.openai/i.test(note) ? AI_BILLING.anthropic : AI_BILLING.openai;
  return (
    <p className={className}>
      {billing ? `${which === AI_BILLING.openai ? "OpenAI" : "Claude"} is out of credits, so Merod answered with its own rules.` : note}
      {billing && <> <a href={which.href} target="_blank" rel="noreferrer noopener" className="font-semibold text-accent-2 underline underline-offset-2 hover:text-text">{which.label} →</a></>}
    </p>
  );
}
