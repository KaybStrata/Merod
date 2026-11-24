import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "@/server/news/service";

test("news reader parses RSS and Atom feeds into headline + link + time", () => {
  const rss = `<?xml version="1.0"?><rss><channel><title>X</title>
    <item><title><![CDATA[Bitcoin tops $100K as $ETH rallies]]></title><link>https://example.com/a</link>
      <pubDate>Mon, 24 Nov 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Markets <b>surged</b> today.</p>]]></description>
      <media:content url="https://example.com/a.jpg" medium="image"/></item>
    <item><title>No link here</title></item></channel></rss>`;
  const a = parseFeed(rss, "Test", "crypto");
  assert.equal(a.length, 1);
  assert.equal(a[0].title, "Bitcoin tops $100K as $ETH rallies");
  assert.equal(a[0].url, "https://example.com/a");
  assert.equal(a[0].summary, "Markets surged today.");
  assert.equal(a[0].image, "https://example.com/a.jpg");
  assert.equal(a[0].publishedAt, "2026-11-24T10:00:00.000Z");
  const atom = `<feed><entry><title>Apple beats earnings</title><link href="https://example.com/b"/><updated>2026-11-24T09:00:00Z</updated><summary>EPS up</summary></entry></feed>`;
  const b = parseFeed(atom, "Test", "stocks");
  assert.equal(b[0].url, "https://example.com/b");
  assert.equal(b[0].category, "stocks");
});
