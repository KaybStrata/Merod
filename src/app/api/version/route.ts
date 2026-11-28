import { NextResponse } from "next/server";

/** Which deploy is running. Open tabs poll this and offer a reload when a new version goes live. */
export const dynamic = "force-dynamic";
export function GET() {
  const v = process.env.RAILWAY_DEPLOYMENT_ID ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? "dev";
  return NextResponse.json({ version: v }, { headers: { "cache-control": "no-store" } });
}
