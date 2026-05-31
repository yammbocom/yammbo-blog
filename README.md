# yammbo-blog

Cloudflare Worker that replaces the n8n workflows `blog-publish-daily` +
`blog-tutorial-daily`. Generates one English blog post per cron, builds an Astro
markdown file + a Nano Banana cover image, and commits both to
`yammbocom/blog.yammbo.com` (which is built by Cloudflare Pages).

## Crons (UTC)

| Cron          | kind       | Vertical |
|---------------|------------|----------|
| `0 15 * * *`  | `blog`     | rotates by weekday (`feeds-config.json` → `schedule`; Sun/Sat = `top` cycles 5 verticals by week, excludes tutorials) |
| `0 21 * * *`  | `tutorial` | `tutorials` — educational, no brand-swap, LLM picks the closing-CTA product |

## Pipeline

1. **Pick vertical** — weekday → vertical (blog) or fixed `tutorials`.
2. **Fetch + parse RSS** — all feeds for the vertical, regex/entity decode, keep
   items from 2026+ and ≤14 days old.
3. **Dedupe + quality gate** — exact title/link match + Jaccard ≥ 0.6, recency /
   content / title scoring, clickbait penalty, threshold 0.55, pick top.
4. **Gemini rewrite** — `gemini-2.5-flash` `:generateContent`, brand-swap (blog)
   or educational (tutorial), `responseSchema` JSON.
5. **Parse + link audit** — sanitize HTML, strip disallowed tags; for each `<a>`:
   keep internal `*.yammbo.com`, drop blocked domains, validate YouTube author via
   oEmbed, HEAD-check external links are live.
6. **Cover image** — Nano Banana (`gemini-2.5-flash-image`, 16:9 PNG): a clean
   conceptual illustration of the topic with the legible title + `YAMMBO` wordmark.
7. **Build markdown** — Astro frontmatter + body (`draft:false`, rotating
   `featured`, `tags` from secondary keywords, `image.src` → `/images/<slug>.png`).
8. **Commit** — Git Data API single commit: `src/content/blog/<slug>.md` +
   `public/images/<slug>.png`.
9. **Persist dedupe** — append title/link to the shared KV doc (cap 2000).

## State

Dedupe state lives in KV (binding `BLOG_DEDUPE`) under a single JSON doc keyed
`blog-publish-daily` (`published_titles[]` + `published_links[]`, cap 2000). Blog
and tutorial share it. Already pre-loaded with the existing 133 titles —
`SEED` bootstrap only fires if the doc is empty.

## Config

`src/feeds-config.json` is the source of truth (verticals, feeds, schedule,
brand-swap table, link policy). Copied verbatim from
`/opt/n8n/workflows-source/feeds-config.json`.

## Endpoints (testing)

- `GET /` → `200` liveness.
- `POST /run?mode=dry&kind=blog|tutorial` (header `x-run-key: $RUN_KEY`) — full
  pipeline **without** the GitHub commit or KV mutation. Returns
  `{ vertical, title, slug, tags, md_chars, cover_base64, ... }`.
- `POST /run?mode=real&kind=...` — full run incl. commit + KV update.

## Secrets (`wrangler secret put`)

- `GEMINI_API_KEY` — `x-goog-api-key` for both Gemini rewrite and Nano Banana.
- `GITHUB_TOKEN` — Bearer for the Git Data API (`yammbocom/blog.yammbo.com`).
- `RUN_KEY` — `x-run-key` auth for `POST /run`.
- `TELEGRAM_BOT_TOKEN` — `@yammbo_alerts_bot` (error / skip alerts).

`TELEGRAM_CHAT_ID`, model names, repo and branch are plain `[vars]` in
`wrangler.toml`.

## Deploy

```sh
cd /root/repos/yammbo-blog
npm install
# set the 4 secrets above, then:
/root/.cf-wrangler.sh deploy
```
