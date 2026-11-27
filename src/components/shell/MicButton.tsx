"use client";
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import { cx } from "@/components/ui";

/**
 * Microphone button for any prompt box: speech → text in the browser (Chrome, Edge, Safari). It keeps listening while
 * you talk, writes what you say into the box as you speak, and stops when you click again or pause. Nothing is sent
 * until you press Send. Hidden in browsers without speech recognition (e.g. Firefox).
 */
export function MicButton({ value, onChange, className, size = "md", onDone }: { value: string; onChange: (t: string) => void; className?: string; size?: "sm" | "md" | "lg"; onDone?: () => void }) {
  const [ok, setOk] = useState(false);
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<any>(null);
  const valRef = useRef(value); valRef.current = value;
  useEffect(() => { setOk(typeof window !== "undefined" && !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)); return () => rec.current?.abort?.(); }, []);
  if (!ok) return null;

  function toggle() {
    if (on) { rec.current?.stop(); return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const r = new SR(); rec.current = r;
    r.lang = navigator.language || "en-US"; r.interimResults = true; r.continuous = true;
    const base = valRef.current ? `${valRef.current.replace(/\s+$/, "")} ` : "";
    r.onresult = (e: any) => onChange(base + Array.from(e.results).map((x: any) => x[0].transcript).join("").replace(/\s+/g, " ").trimStart());
    r.onend = () => { setOn(false); onDone?.(); };
    r.onerror = (e: any) => { setOn(false); setErr(e?.error === "not-allowed" ? "Allow microphone access in your browser to use voice." : e?.error === "no-speech" ? null : "Voice input stopped."); };
    setErr(null); setOn(true);
    try { r.start(); } catch { setOn(false); }
  }
  const sz = size === "sm" ? "size-8" : size === "lg" ? "size-10" : "size-9";
  return (
    <button type="button" onClick={toggle} aria-pressed={on} aria-label={on ? "Stop voice input" : "Speak your prompt"}
      title={err ?? (on ? "Listening… click to stop" : "Speak instead of typing (your browser turns speech into text; nothing is sent until you press Send)")}
      className={cx("relative flex shrink-0 items-center justify-center rounded-xl", sz, on ? "bg-down text-white" : err ? "text-warn hover:bg-panel-2" : "text-muted hover:bg-panel-2 hover:text-text", className)}>
      {err && !on ? <MicOff className="size-4" /> : <Mic className="size-4" />}
      {on && <span className="absolute inset-0 animate-ping rounded-xl bg-down/40" aria-hidden />}
    </button>
  );
}
