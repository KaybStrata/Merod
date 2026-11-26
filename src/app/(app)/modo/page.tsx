"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function ModoIndex() {
  const r = useRouter();
  useEffect(() => { r.replace("/modo/activity"); }, [r]);
  return null;
}
