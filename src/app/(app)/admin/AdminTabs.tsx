"use client";
import { Shield, Plug, Percent } from "lucide-react";
import { SectionTabs } from "@/components/SectionTabs";

/** Admin | Integrations | Fees buttons at the top of every admin page (Fees is owner-only). */
export function AdminTabs({ superAdmin }: { superAdmin: boolean }) {
  return <SectionTabs tabs={[
    { href: "/admin", label: "Admin", icon: Shield, exact: true },
    { href: "/admin/integrations", label: "Integrations", icon: Plug },
    ...(superAdmin ? [{ href: "/admin/fees", label: "Fees", icon: Percent }] : []),
  ]} />;
}
