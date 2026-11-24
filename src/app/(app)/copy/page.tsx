import { redirect } from "next/navigation";

/** Copy trading was folded into Mimic trading. */
export default function CopyTradingPage() {
  redirect("/mimic");
}
