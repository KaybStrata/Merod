import { redirect } from "next/navigation";
import { getUser } from "@/server/auth";

/** Automations: auto trading, mimic, copy and sessions (owner) or sessions (everyone else). */
export default async function Automations() {
  const u = await getUser();
  redirect(u?.role === "super_admin" ? "/auto" : "/sessions");
}
