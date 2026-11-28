"use client";
import { useLayoutEffect, useRef, useState } from "react";

/**
 * For a popup anchored to a button: open toward the side that has room. Returns a ref for the anchor wrapper and
 * "left" (popup's left edge on the button, extends right) or "right" (popup's right edge on the button, extends left).
 */
export function usePopSide<T extends HTMLElement = HTMLDivElement>(open: boolean, width: number) {
  const ref = useRef<T>(null);
  const [side, setSide] = useState<"left" | "right">("left");
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setSide(r.left + Math.min(width, window.innerWidth * 0.9) > window.innerWidth - 8 ? "right" : "left");
  }, [open, width]);
  return { ref, side, cls: side === "left" ? "left-0" : "right-0" };
}
