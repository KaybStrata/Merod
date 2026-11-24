"use client";
import { Repeat, Copy, Cpu } from "lucide-react";
import { SectionTabs } from "@/components/SectionTabs";

/** Mimic trading | Copy trading | Auto trading buttons at the top of each page in the section. */
export function MimicTabs() {
  return <SectionTabs tabs={[{ href: "/mimic", label: "Mimic trading", icon: Repeat }, { href: "/copy", label: "Copy trading", icon: Copy }, { href: "/auto", label: "Auto trading", icon: Cpu }]} />;
}
