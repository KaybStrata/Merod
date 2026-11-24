"use client";
import { Repeat, Cpu } from "lucide-react";
import { SectionTabs } from "@/components/SectionTabs";

/** Mimic trading | Auto trading buttons at the top of both pages. */
export function MimicTabs() {
  return <SectionTabs tabs={[{ href: "/mimic", label: "Mimic trading", icon: Repeat }, { href: "/auto", label: "Auto trading", icon: Cpu }]} />;
}
