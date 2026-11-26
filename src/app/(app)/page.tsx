"use client";
import { HomeView } from "@/components/home/HomeView";
import { TalkDefaultRedirect } from "@/components/talk/TalkDefaultRedirect";

/** Home: equity, chart, Ask Merod, holdings, active agents, watchlist and recent fills. */
export default function Home() {
  return <><TalkDefaultRedirect /><HomeView /></>;
}
