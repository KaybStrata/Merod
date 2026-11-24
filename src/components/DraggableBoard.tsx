"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { GripHorizontal, Columns2, RotateCcw } from "lucide-react";
import { cx } from "@/components/ui";

export type BlockSize = "third" | "half" | "wide" | "full";
export interface Block { id: string; title: string; size: BlockSize; node: ReactNode }

const SIZE_CLASS: Record<BlockSize, string> = {
  third: "lg:col-span-6 xl:col-span-4",
  half: "lg:col-span-6",
  wide: "lg:col-span-12 xl:col-span-8",
  full: "lg:col-span-12",
};
const NEXT_SIZE: Record<BlockSize, BlockSize> = { third: "half", half: "wide", wide: "full", full: "third" };
const SIZE_LABEL: Record<BlockSize, string> = { third: "Small", half: "Medium", wide: "Large", full: "Full width" };

/**
 * A dashboard whose cards can be rearranged: grab the grip on top of a card and drag it anywhere
 * (mouse or touch), or focus the grip and use the arrow keys. The width button cycles card sizes.
 * The layout is remembered in this browser.
 */
export function DraggableBoard({ storageKey, blocks }: { storageKey: string; blocks: Block[] }) {
  const ids = blocks.map((b) => b.id);
  const [order, setOrder] = useState<string[]>(ids);
  const [sizes, setSizes] = useState<Record<string, BlockSize>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const [customised, setCustomised] = useState(false);
  const orderRef = useRef(order); orderRef.current = order;

  // Load the saved layout; new cards added in future updates appear at the end.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (saved?.order) {
        const known = saved.order.filter((id: string) => ids.includes(id));
        setOrder([...known, ...ids.filter((id) => !known.includes(id))]);
        setSizes(saved.sizes ?? {});
        setCustomised(true);
      }
    } catch { /* storage unavailable: default layout */ }
  }, [storageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = useCallback((o: string[], s: Record<string, BlockSize>) => {
    setCustomised(true);
    try { localStorage.setItem(storageKey, JSON.stringify({ order: o, sizes: s })); } catch { /* ignore */ }
  }, [storageKey]);

  const move = (id: string, to: number) => setOrder((cur) => {
    const from = cur.indexOf(id); if (from < 0 || to === from) return cur;
    const next = [...cur]; next.splice(from, 1); next.splice(Math.max(0, Math.min(next.length, to)), 0, id);
    return next;
  });

  function startDrag(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return;
    e.preventDefault();
    setDragId(id);
    let scrollTimer: ReturnType<typeof setInterval> | null = null;
    let lastY = e.clientY;
    const onMove = (ev: PointerEvent) => {
      lastY = ev.clientY;
      const target = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>("[data-board-id]");
      const overId = target?.dataset.boardId;
      if (!overId || overId === id) return;
      const r = target!.getBoundingClientRect();
      const cur = orderRef.current, overIdx = cur.indexOf(overId), fromIdx = cur.indexOf(id);
      // Drop before or after the hovered card, depending on which half the pointer is in.
      const after = r.width > window.innerWidth * 0.6 ? ev.clientY > r.top + r.height / 2 : ev.clientX > r.left + r.width / 2 || ev.clientY > r.bottom - 12;
      let to = overIdx + (after ? 1 : 0);
      if (fromIdx < to) to -= 1;
      move(id, to);
    };
    // Auto-scroll while dragging near the top/bottom of the window.
    scrollTimer = setInterval(() => { if (lastY < 80) window.scrollBy(0, -14); else if (lastY > window.innerHeight - 80) window.scrollBy(0, 14); }, 16);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (scrollTimer) clearInterval(scrollTimer);
      setDragId(null);
      save(orderRef.current, sizesRef.current);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }
  const sizesRef = useRef(sizes); sizesRef.current = sizes;

  const byId = new Map(blocks.map((b) => [b.id, b]));
  return (
    <div>
      <div className={cx("grid grid-cols-1 items-start gap-4 lg:grid-cols-12", dragId && "select-none")}>
        {order.map((id, i) => {
          const b = byId.get(id); if (!b) return null;
          const size = sizes[id] ?? b.size;
          return (
            <div key={id} data-board-id={id}
              className={cx("group/board relative min-w-0 transition-[opacity,transform] duration-150", SIZE_CLASS[size],
                dragId === id && "z-20 scale-[0.99] opacity-70 [&>*]:ring-2 [&>*]:ring-accent/60 rounded-xl")}>
              {/* Grip on the top edge of every card: drag to move; width button cycles the size. */}
              <div className={cx("absolute -top-2.5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-full border border-line bg-panel px-1 py-0.5 shadow-lg transition-opacity",
                dragId === id ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover/board:opacity-100 [@media(hover:none)]:opacity-100")}>
                <button type="button" onPointerDown={(e) => startDrag(e, id)} aria-label={`Move ${b.title} (drag, or use arrow keys)`} title={`Drag to move “${b.title}”`}
                  onKeyDown={(e) => {
                    if (["ArrowUp", "ArrowLeft"].includes(e.key)) { e.preventDefault(); move(id, i - 1); save(orderRef.current.slice(), sizes); }
                    if (["ArrowDown", "ArrowRight"].includes(e.key)) { e.preventDefault(); move(id, i + 1); save(orderRef.current.slice(), sizes); }
                  }}
                  className={cx("flex items-center rounded-full px-2 py-0.5 text-muted hover:text-text", dragId === id ? "cursor-grabbing" : "cursor-grab")} style={{ touchAction: "none" }}>
                  <GripHorizontal className="size-4" />
                </button>
                <button type="button" onClick={() => { const next = { ...sizes, [id]: NEXT_SIZE[size] }; setSizes(next); save(order, next); }}
                  className="flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] text-muted hover:text-text" title="Change card width">
                  <Columns2 className="size-3.5" /><span className="hidden sm:inline">{SIZE_LABEL[size]}</span>
                </button>
              </div>
              {b.node}
            </div>
          );
        })}
      </div>
      {customised && (
        <div className="mt-3 flex justify-end">
          <button onClick={() => { setOrder(ids); setSizes({}); setCustomised(false); try { localStorage.removeItem(storageKey); } catch { /* ignore */ } }}
            className="flex items-center gap-1 text-[11px] text-faint hover:text-text"><RotateCcw className="size-3" /> Reset card layout</button>
        </div>
      )}
    </div>
  );
}
