"use client";
import Link from "next/link";
import { useState } from "react";
import { Heart, MessageCircle, Bookmark, BadgeCheck, FlaskConical, HelpCircle, Trash2, Send, Copy } from "lucide-react";
import { api } from "@/lib/api";
import { ago, price, pct } from "@/lib/format";
import { Badge, Button, cx, useToast, AssetIcon } from "@/components/ui";

export function Avatar({ name, color, size = 40 }: { name: string; color?: string | null; size?: number }) {
  const c = color ?? "#38bdf8";
  return <span style={{ width: size, height: size, background: `${c}26`, color: c, fontSize: size * 0.4 }} className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold">{name.slice(0, 1).toUpperCase()}</span>;
}

export function VerificationBadge({ v }: { v: string }) {
  if (v === "verified_live") return <Badge tone="up" title="Linked to a filled real-money order owned by the poster"><BadgeCheck className="size-3" /> Verified live trade</Badge>;
  if (v === "simulated") return <Badge tone="warn" title="Linked to a filled paper (simulated) order — not real money"><FlaskConical className="size-3" /> Simulated (paper)</Badge>;
  return <Badge tone="neutral" title="Not linked to a filled order — treat as an opinion"><HelpCircle className="size-3" /> Unverified</Badge>;
}

const KIND_TONE: Record<string, "accent" | "up" | "info" | "warn"> = { post: "accent", trade: "up", analysis: "info", strategy: "warn" };

export function PostCard({ post, me, onChange, copyTradingEnabled = false }: { post: any; me: string; onChange?: () => void; copyTradingEnabled?: boolean }) {
  const toast = useToast();
  const [liked, setLiked] = useState<boolean>(post.liked);
  const [likes, setLikes] = useState<number>(post.likes);
  const [bookmarked, setBookmarked] = useState<boolean>(post.bookmarked);
  const [following, setFollowing] = useState<boolean>(post.following);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[] | null>(null);
  const [commentCount, setCommentCount] = useState<number>(post.comments);
  const [draft, setDraft] = useState("");
  const mine = post.handle === me;

  const act = (body: any) => api(`/api/social/posts/${post.id}`, { method: "POST", json: body });
  async function toggleLike() { const n = !liked; setLiked(n); setLikes((x) => x + (n ? 1 : -1)); try { await act({ action: n ? "like" : "unlike" }); } catch (e: any) { toast(e.message, "down"); } }
  async function toggleBookmark() { const n = !bookmarked; setBookmarked(n); try { await act({ action: n ? "bookmark" : "unbookmark" }); } catch (e: any) { toast(e.message, "down"); } }
  async function toggleFollow() { const n = !following; setFollowing(n); try { await api("/api/social/follow", { method: "POST", json: { handle: post.handle, follow: n } }); } catch (e: any) { setFollowing(!n); toast(e.message, "down"); } }
  async function loadComments() { const r = await api(`/api/social/posts/${post.id}`); setComments(r.comments); }
  async function sendComment() {
    if (!draft.trim()) return;
    try { await act({ action: "comment", body: draft }); setDraft(""); setCommentCount((c) => c + 1); await loadComments(); } catch (e: any) { toast(e.message, "down"); }
  }
  async function remove() {
    if (!confirm("Delete this post?")) return;
    try { await api(`/api/social/posts/${post.id}`, { method: "DELETE" }); onChange?.(); } catch (e: any) { toast(e.message, "down"); }
  }

  return (
    <article className="border-b border-line px-4 py-4 last:border-0">
      <div className="flex gap-3">
        <Link href={`/social/${post.handle}`}><Avatar name={post.display_name} color={post.avatar_color} /></Link>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link href={`/social/${post.handle}`} className="font-semibold hover:underline">{post.display_name}</Link>
            <span className="text-sm text-muted">@{post.handle} · {ago(post.created_at)}</span>
            {post.visibility !== "public" && <Badge>{post.visibility}</Badge>}
            <span className="ml-auto flex items-center gap-1">
              {!mine && <Button size="sm" variant={following ? "secondary" : "outline"} onClick={toggleFollow}>{following ? "Following" : "Follow"}</Button>}
              {mine && <button onClick={remove} className="rounded p-1 text-faint hover:text-down" aria-label="Delete post"><Trash2 className="size-4" /></button>}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge tone={KIND_TONE[post.kind] ?? "accent"}>{post.kind[0].toUpperCase() + post.kind.slice(1)}</Badge>
          </div>
          {/* Untrusted user text rendered as plain text only */}
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-text">{post.body}</p>
          {post.tagged?.map((t: any) => {
            const ch = t.entry_price && t.last_price ? ((t.last_price - t.entry_price) / t.entry_price) * 100 * (t.side === "sell" ? -1 : 1) : null;
            return (
              <div key={t.asset_id} className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-bg-2/60 px-3 py-2.5">
                <AssetIcon symbol={t.symbol} size={30} />
                <Link href={`/terminal/${t.asset_id}`} className="min-w-0"><div className="font-semibold">{t.symbol}</div><div className="text-xs text-muted">{t.venue}</div></Link>
                {t.side && <Badge tone={t.side === "buy" ? "up" : "down"}>{t.side.toUpperCase()}</Badge>}
                {t.entry_price && <span className="num text-sm text-muted">{price(t.entry_price)} → {price(t.last_price)}{t.price_source === "simulated" && <span className="text-warn"> (sim)</span>}</span>}
                {ch != null && <span className={cx("num text-sm font-semibold", ch >= 0 ? "text-up" : "text-down")}>{pct(ch)}</span>}
                <span className="ml-auto flex items-center gap-2">
                  <VerificationBadge v={t.verification} />
                  {!mine && (
                    <span title={copyTradingEnabled ? "" : "Requires compliance approval (copy_trading flag off)"}>
                      <Button size="sm" variant="secondary" disabled={!copyTradingEnabled}><Copy className="size-3.5" /> Copy trade</Button>
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          {post.tags?.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{post.tags.map((t: string) => <span key={t} className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-accent-2">#{t}</span>)}</div>}
          <div className="mt-3 flex items-center gap-5 text-sm text-muted">
            <button onClick={toggleLike} className={cx("flex items-center gap-1.5 hover:text-text", liked && "text-down")}><Heart className={cx("size-4", liked && "fill-current")} /> {likes}</button>
            <button onClick={() => { setShowComments(!showComments); if (!comments) loadComments(); }} className="flex items-center gap-1.5 hover:text-text"><MessageCircle className="size-4" /> {commentCount}</button>
            <button onClick={toggleBookmark} className={cx("flex items-center gap-1.5 hover:text-text", bookmarked && "text-accent-2")}><Bookmark className={cx("size-4", bookmarked && "fill-current")} /></button>
          </div>
          {showComments && (
            <div className="mt-3 space-y-2 rounded-xl bg-bg-2/50 p-3">
              {comments?.length === 0 && <div className="text-xs text-faint">No comments yet.</div>}
              {comments?.map((c) => (
                <div key={c.id} className="flex gap-2 text-sm">
                  <Avatar name={c.display_name} color={c.avatar_color} size={24} />
                  <div className="min-w-0 flex-1"><span className="font-medium">@{c.handle}</span> <span className="text-xs text-faint">{ago(c.created_at)}</span>
                    <p className="whitespace-pre-wrap break-words text-muted">{c.body}</p></div>
                  {c.mine && <button onClick={async () => { await act({ action: "delete_comment", commentId: c.id }); setCommentCount((x) => x - 1); loadComments(); }} className="text-faint hover:text-down" aria-label="Delete comment"><Trash2 className="size-3.5" /></button>}
                </div>
              ))}
              <div className="flex gap-2">
                <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendComment()} maxLength={1000} placeholder="Write a comment…"
                  className="h-9 flex-1 rounded-lg border border-line bg-panel px-3 text-sm outline-none focus:border-accent" />
                <Button size="sm" variant="primary" onClick={sendComment} aria-label="Send comment"><Send className="size-3.5" /></Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
