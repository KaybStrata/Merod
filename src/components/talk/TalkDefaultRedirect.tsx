"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useShell, startupMode, TALK_FLAG } from "@/components/shell/context";

/**
 * Home only: if Settings › Interface says to open in Talk (or "Remember last" and the last mode was Talk), go to /talk once per
 * browser session. Deep links to classic pages never redirect. Off when the Talk flag is off.
 */
export function TalkDefaultRedirect() {
  const { talk } = useShell();
  const router = useRouter();
  useEffect(() => {
    if (!TALK_FLAG || !talk) return;
    try {
      if (sessionStorage.getItem("merod-talk-redirected")) return;
      sessionStorage.setItem("merod-talk-redirected", "1");
    } catch { return; }
    if (startupMode(talk) === "talk") router.replace("/talk");
  }, [talk, router]);
  return null;
}
