/**
 * yammbo-blog — Cloudflare Worker replacing the n8n workflows
 * `blog-publish-daily` + `blog-tutorial-daily`.
 *
 * Two daily crons (UTC):
 *   15:00 -> "blog": vertical rotates by weekday (CFG.schedule; Sun/Sat="top"
 *            cycles 5 verticals by week, excludes tutorials). Brand-swap applies.
 *   21:00 -> "tutorial": educational, NO brand-swap, the LLM picks the most
 *            relevant Yammbo product for the closing CTA.
 *
 * Pipeline (faithful port of the n8n Code nodes):
 *   pick vertical -> fetch RSS feeds -> parse -> dedupe + quality gate + pick top
 *   -> build Gemini prompt -> Gemini 2.5 Flash rewrite -> parse/sanitize + link
 *   audit (HEAD-check + YouTube oEmbed + blocklist) -> Nano Banana 16:9 cover
 *   -> build Astro markdown -> commit (md + png) to GitHub via the Git Data API
 *   -> update dedupe doc in KV.
 *
 * Dedupe state lives in KV (binding BLOG_DEDUPE) under a single JSON doc keyed
 * "blog-publish-daily"; blog and tutorial share it. Pre-seeded with the existing
 * 133 titles by the parent — SEED bootstrap only runs if the doc is empty.
 *
 * /run endpoint (x-run-key auth): mode=dry runs everything EXCEPT the GitHub
 * commit and the KV mutation, and returns the cover as base64 for preview.
 */
import CFG from './feeds-config.json';

export interface Env {
  BLOG_DEDUPE: KVNamespace;
  GEMINI_API_KEY: string;
  GITHUB_TOKEN: string;
  RUN_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_CHAT_ID: string;
  GEMINI_MODEL: string;
  IMAGE_MODEL: string;
  GITHUB_REPO: string;
  GITHUB_BRANCH: string;
}

const cfg = CFG as any;

const DEDUPE_KEY = 'blog-publish-daily';
const MAX_AGE_DAYS = 21;
const QUALITY_THRESHOLD = 0.55;

// ───────────────────────── SEED (dedupe bootstrap) ─────────────────────────
// Used ONLY when the KV doc is empty (first run on a fresh namespace). The
// production namespace is already pre-loaded with 133 titles by the parent, so
// in practice this never fires. Ported verbatim from Pick_vertical.js.
const SEED_TITLES: string[] = [
  'boost your business major updates revolutionize online and in person sales',
  'unleashing vision language models on nvidia jetson ai at the edge',
  'unlock your rankings choosing seo friendly web hosting',
  'lights camera impact crafting a video portfolio that gets you hired',
  'build your future crafting a student portfolio that shines',
  "spotify s australian symphony powering homegrown talent to global stages",
  'spotify coca cola riding into houston rodeo with a rhinestone cowboy experience',
  'unveiling the vision fka twigs jordan hemingway on crafting hard',
  'mastering your tech inventory the essential guide to hardware asset management',
  'your inbox deconstructed a billion email dive reveals surprising truths',
  'a decade of dakar ii kwesta s iconic album still shaping south african hip hop',
  'unlock your potential crafting a marketing portfolio that gets you hired',
  'beyond spreadsheets revolutionizing asset management with check in check out software',
  'unveiling february s best ambient gems on bandcamp a yammbo deep dive',
  'gpt 5 4 a game changer for brands in ai search citing websites directly',
  'navigating the digital landscape your guide to website builder types',
  'unearthing the myth fugazi s legendary albini sessions finally revealed',
  'when the spotlight hits how restaurants can master sudden surges',
  'young miko brings the heat gap s spring 2026 campaign electrifies style and sound',
  'craft your digital masterpiece the ultimate guide to portfolio website builders',
  'which domain extension is best for your brand a yammbo guide',
  'bad bunny s tokyo triumph celebrating billions and bridging cultures on spotify',
  'unlock your earning potential 15 innovative ways to make money with ai',
  'boost your website traffic 10 free strategies that work',
  'unearthing sonic gems march 2026 s must hear music releases',
  'unlocking ai s potential nvidia nemo retriever s generalizable agentic pipeline',
  'kim gordon s sonic evolution embracing hip hop beats in play me',
  'beyond taglines crafting slogans that define brands in the digital age',
  'crafting your brand s soul inspiring examples of brand identity done right',
  'crafting your digital identity the art of naming your website',
  'unlock your personal brand a guide to choosing the right domain extension',
  'launch your fashion dream a 10 step guide to starting an online clothing business',
  'spinning success crafting slogans that build brand loyalty in the digital age',
  'hostinger s 11 8 million payout empowering employees through shared success',
  'chicha forever unearthing the vibrant evolution of peruvian cumbia',
  'unlock your creative potential the ultimate guide to print on demand success',
  'how lubus mastered wordpress com for unbeatable agency efficiency',
  'march s sonic explorations unveiling essential global music releases',
  'navigating the nuances why multimodal multilingual ai safety is essential',
  'unlock rag potential build domain specific embeddings in under a day',
  'launch your wellness empire a tech driven guide to health business success',
  'launch your dream t shirt business the ultimate print on demand guide',
  'mastering mobile 15 stellar website designs that shine on any screen',
  'the blueprint for growth crafting your impactful marketing strategy',
  'navigating the ai visibility frontier profound vs surfer ai tracker',
  'unleash your creativity the top website builders for artists in 2024',
  'unlock your teaching potential a step by step guide to launching a thriving tutoring business',
  'drive your business forward the essential guide to building a car rental website',
  'unlock your digital potential crafting a stunning website with ease',
  'supercharge your ai workflows real time web data with firecrawl n8n',
  'unlock your potential launching a thriving events experiences business',
  'shatter the myth your 9 to 5 is your secret weapon as a woman entrepreneur',
  'beyond skills launching a thriving professional services business in the digital age',
  'unveiling the ai shopping revolution agentic commerce tracking explained',
  'the conversational revolution unpacking the power of ai chat',
  'unlocking web design excellence 15 ai powered websites for digital inspiration',
  'unlock growth crafting an irresistible dental website for your practice',
  'unlock rapid app development the power of vibe coding tools',
  'unveiling the ai gaze what 60 tests reveal about how llms see your website',
  'beyond passion structuring your thriving creative services business',
  'how much does a website really cost in 2026 decoding your digital investment',
  'youtube brandcast 2026 ushering in a new era of media and creator power',
  'holo3 ushering in the next era of human computer interaction',
  'building robust ai the power of deterministic ai steps',
  'coachella 2026 your ultimate guide to an immersive youtube livestream',
  'unlock higher rankings 11 essential strategies for content optimization',
  'beyond the split unpacking earl sweatshirt mike surf gang s pompeii utility',
  'beyond the count why smart inventory audits are your business s secret weapon',
  'how to launch a thriving pet business your guide to online success',
  'mastering your digital presence a guide to working with a web designer',
  'march s jazz gems discovering new sounds on bandcamp',
  'scaling rag systems building robust architectures for production ai',
  'unleashing sonic chaos revisiting musica transonic mainliner s solid static',
  'how fast can you launch your dream website with wix',
  'unearthing diy gems scissor fits and the enduring spirit of uk post punk',
  'ai visibility showdown writesonic vs omnia for 2026 success',
  'talat market how chef driven tech fuels culinary success',
  'outgrown webflow how to seamlessly migrate to woocommerce for ultimate e commerce control',
  'the weight of illumination nate garrett s profound journey to spirit adrift s final lp',
  'ai agents your secret weapon for effortless online business management',
  'unleash your business potential the power of ai agents in website building',
  'wix harmony ai speed meets human control for effortless website creation',
  'boost your health wellness business marketing that connects',
  'power up your business build a killer electrician website',
  'from nyc pop ups to coachella the meteoric rise of whatmore',
  'unlock your online potential building a professional no code website made easy',
  'unlock simplicity building a static website in 4 easy steps',
  'turn your craft hobby into a thriving online business a 6 step guide',
  'craft your fashion future build a stunning portfolio in 9 steps',
  'eve maret s diamond cutter where electronic music meets the divine',
  'unlock your earning potential a comprehensive guide to making money blogging',
  'unleash your creativity a modern marketing guide for creative services',
  'unlocking success your guide to marketing an events and experiences business',
  'unlock your potential the ultimate guide to building a stellar ugc portfolio',
  'crafting your digital showcase the ultimate guide to a professional video portfolio',
];

// ───────────────────────── small helpers ─────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function norm(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ───────────────────────── 1. pick vertical ─────────────────────────
// Ported from Pick_vertical.js + the tutorial workflow's "Pick tutorials".
function pickVertical(kind: 'blog' | 'tutorial'): { verticalKey: string; vertical: any } {
  if (kind === 'tutorial') {
    const vertical = cfg.verticals.tutorials;
    if (!vertical) throw new Error('Missing tutorials vertical in CFG');
    return { verticalKey: 'tutorials', vertical };
  }
  const now = new Date();
  const dow = String(now.getUTCDay());
  let verticalKey = cfg.schedule[dow];
  if (verticalKey === 'top') {
    // Sun+Sat: cycle through verticals deterministically by week. Exclude
    // 'tutorials' (daily-only workflow).
    const week = Math.floor(now.getTime() / (1000 * 60 * 60 * 24 * 7));
    const keys = Object.keys(cfg.verticals).filter((k) => k !== 'tutorials');
    verticalKey = keys[week % keys.length];
  }
  const vertical = cfg.verticals[verticalKey];
  if (!vertical) throw new Error('No vertical config for ' + verticalKey);
  return { verticalKey, vertical };
}

// ───────────────────────── 2. fetch + parse RSS ─────────────────────────
function decodeEntities(str: string): string {
  return (str || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(+n));
}
function stripHtml(html: string): string {
  return decodeEntities((html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}
function unwrap(t: string): string {
  if (!t) return '';
  const m = t.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return decodeEntities(m ? m[1] : t).trim();
}
function field(block: string, tag: string): string {
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>', 'i');
  const m = block.match(re);
  return m ? unwrap(m[1]) : '';
}

interface FeedItem {
  feed_url: string;
  title: string;
  link: string;
  desc_text: string;
  content_text: string;
  pub_iso: string | null;
  age_days: number;
  title_norm: string;
}

async function fetchFeed(feedUrl: string): Promise<string> {
  // Port of "Fetch feed" HTTP node (neverError -> swallow failures).
  try {
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    const resp = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'YammboBlogBot/1.0 (+https://blog.yammbo.com)',
        Accept:
          'application/rss+xml,application/atom+xml,application/xml;q=0.9,*/*;q=0.5',
      },
      signal: ctrl.signal,
    });
    clearTimeout(to);
    if (!resp.ok) return '';
    return await resp.text();
  } catch {
    return '';
  }
}

function parseFeed(feedUrl: string, xml: string): FeedItem[] {
  const out: FeedItem[] = [];
  if (!xml || typeof xml !== 'string') return out;

  const itemBlocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
  const entryBlocks = xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  const blocks = itemBlocks.length ? itemBlocks : entryBlocks;

  for (const b of blocks) {
    const title = field(b, 'title');
    let link = field(b, 'link');
    if (!link) {
      const m = b.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
      if (m) link = m[1];
    }
    const desc = field(b, 'description') || field(b, 'summary') || field(b, 'content');
    const content = field(b, 'content:encoded') || field(b, 'content') || desc;
    const pub = field(b, 'pubDate') || field(b, 'published') || field(b, 'updated');
    if (!title || !link) continue;
    const pubMs = pub ? Date.parse(pub) : 0;
    const ageDays = pubMs ? (Date.now() - pubMs) / (1000 * 60 * 60 * 24) : 999;
    if (ageDays > 14) continue;
    // Only accept items from 2026-01-01 onwards (per Yambo policy 2026-04-28).
    if (!pubMs || new Date(pubMs).getUTCFullYear() < 2026) continue;
    out.push({
      feed_url: feedUrl,
      title: title.slice(0, 300),
      link: link.trim(),
      desc_text: stripHtml(desc).slice(0, 800),
      content_text: stripHtml(content).slice(0, 4000),
      pub_iso: pubMs ? new Date(pubMs).toISOString() : null,
      age_days: ageDays,
      title_norm: norm(title),
    });
  }
  return out;
}

// ───────────────────────── 3. dedupe + quality gate + pick top ───────────
// Ported from Dedupe___pick_top.js. Dedupe state comes from KV (see DedupeDoc).
const CLICKBAIT_PATTERNS: RegExp[] = [
  /^unlock\s+your\b/i,
  /^boost\s+your\b/i,
  /^master\s+your\b/i,
  /^unleash\s+your\b/i,
  /^supercharge\s+your\b/i,
  /^elevate\s+your\b/i,
  /^transform\s+your\b/i,
  /^revolutionize\s+your\b/i,
  /\bultimate\s+guide\b/i,
];

interface DedupeDoc {
  published_titles: string[];
  published_links: string[];
  bootstrapped?: boolean;
  bootstrap_at?: string;
  last_publish_ts?: string;
  last_publish_vertical?: string;
  last_publish_title?: string | null;
  [k: string]: any;
}

function tokens(s: string): Set<string> {
  return new Set((s || '').split(/\s+/).filter((t) => t.length >= 4));
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const t of a) if (b.has(t)) i++;
  return i / (a.size + b.size - i);
}
function clickbaitPenalty(title: string): number {
  return CLICKBAIT_PATTERNS.some((re) => re.test(title || '')) ? 0.12 : 0;
}
function recencyScore(ageDays: number): number {
  if (ageDays <= 3) return 1.0;
  if (ageDays <= 7) return 0.7;
  if (ageDays <= 14) return 0.35;
  if (ageDays <= 21) return 0.15;
  return 0;
}

interface Picked {
  title: string;
  link: string;
  desc: string;
  content: string;
  pub_iso: string | null;
  feed_url: string;
  _score: number;
  _score_parts: any;
}

function dedupePickTop(all: FeedItem[], sd: DedupeDoc): { picked: Picked | null; reason?: string; debug: any } {
  const debug: any = { total_fetched: all.length };
  if (!all.length) return { picked: null, reason: 'no_items_after_parse', debug };

  const publishedTokenSets = sd.published_titles.map(tokens);
  const fresh: (FeedItem & { _score: number; _score_parts: any })[] = [];
  const dropReasons: any = { age_cap: 0, dup_link: 0, dup_title: 0, dup_jaccard: 0 };

  for (const it of all) {
    if (sd.published_links.includes(it.link)) {
      dropReasons.dup_link++;
      continue;
    }
    if (sd.published_titles.includes(it.title_norm)) {
      dropReasons.dup_title++;
      continue;
    }
    if (it.age_days > MAX_AGE_DAYS) {
      dropReasons.age_cap++;
      continue;
    }
    const ts = tokens(it.title_norm);
    let dup = false;
    for (const ps of publishedTokenSets) {
      if (jaccard(ts, ps) >= 0.6) {
        dup = true;
        break;
      }
    }
    if (dup) {
      dropReasons.dup_jaccard++;
      continue;
    }

    const rscore = recencyScore(it.age_days);
    const cscore = Math.min(1, it.content_text.length / 2000);
    const tlen = (it.title || '').length;
    const tscore = tlen > 25 && tlen < 110 ? 1.0 : 0.4;
    const penalty = clickbaitPenalty(it.title);
    const _score = +(rscore * 0.6 + cscore * 0.25 + tscore * 0.15 - penalty).toFixed(4);
    fresh.push({ ...it, _score, _score_parts: { rscore, cscore, tscore, penalty } });
  }
  fresh.sort((a, b) => b._score - a._score);
  debug.candidates_after_dedupe = fresh.length;
  debug.drop_reasons = dropReasons;

  if (!fresh.length) return { picked: null, reason: 'no_fresh_candidate', debug };

  const top = fresh[0];
  if (top._score < QUALITY_THRESHOLD) {
    debug.best_score = top._score;
    debug.best_title = top.title;
    debug.best_score_parts = top._score_parts;
    return { picked: null, reason: 'below_quality_threshold', debug };
  }

  return {
    picked: {
      title: top.title,
      link: top.link,
      desc: top.desc_text,
      content: top.content_text,
      pub_iso: top.pub_iso,
      feed_url: top.feed_url,
      _score: top._score,
      _score_parts: top._score_parts,
    },
    debug,
  };
}

// ───────────────────────── 4. build Gemini prompt ─────────────────────────
// Ported from Build_Gemini_prompt.js.
function buildGeminiRequest(vertical: any, source: Picked): any {
  const rr = cfg.rewrite_rules;
  const policy = cfg.publishing.link_policy || {};
  const blockedBrands = (policy.blocked_brand_names_for_youtube || []).join(', ');
  const mode = vertical.prompt_mode || 'rewrite';

  const linkPolicyLines = [
    'LINK POLICY (applies to EVERY <a href> in body_html):',
    '   a. INTERNAL links to *.yammbo.com are ALWAYS allowed.',
    '   b. EXTERNAL links are ALLOWED when they add real value: official documentation, neutral references (MDN, Wikipedia, Stack Overflow), tools, learning resources, primary sources. Prefer 1-4 external links per post, anchored on descriptive text — never naked URLs.',
    '   c. NEVER link to any of the following competitor brands or their domains, even if relevant. This list is enforced post-processing so links to them will be stripped: ' +
      blockedBrands +
      '.',
    '   d. NEVER link to YouTube videos uploaded by the channels of those blocked brands (the system validates the video author via oEmbed and strips them).',
    '   e. Every external link will be HEAD-checked at publish time; broken or unreachable links are stripped automatically. Prefer durable, well-maintained sources.',
    '   f. NEVER include <img>, <script>, <iframe>, inline styles, or custom CSS classes.',
  ];

  let system: string;
  if (mode === 'tutorial') {
    const productsList = [
      '   - Yammbo Music — music streaming — https://music.yammbo.com',
      '   - Yammbo Web — AI-powered website builder — https://web.yammbo.com',
      '   - Yammbo POS — restaurant point-of-sale + online ordering — https://pos.yammbo.com',
      '   - Yammbo Store — online store builder — https://store.yammbo.com',
      '   - Yammbo Vcard — digital business cards + bio links — https://vcard.yammbo.com',
    ].join('\n');

    system = [
      'ROLE: You are a senior technical writer for the Yammbo SaaS company blog (blog.yammbo.com). Your job here is teaching, not selling.',
      '',
      'TASK: Rewrite the supplied source article as an original, hands-on tutorial in clear American English (en_US). The post must read as a native Yammbo tutorial — practical, step-driven, no marketing fluff, no rewriting fingerprints.',
      '',
      'STRICT RULES:',
      '1. NEVER mention or reference the source publication, the source URL, the source brand, or any of its writers.',
      '2. DO NOT do brand-swap replacements. Competitor or vendor brand names MAY appear in factual technical context (e.g., "Stripe Webhooks deliver POST payloads to your endpoint..."), but the post must NOT frame Yammbo as a competitor or alternative to them. Focus on teaching the concept, not pushing the product.',
      '3. ' + linkPolicyLines.join('\n'),
      '4. HTML must be Astra-theme compatible: ONLY <h2>, <h3>, <p>, <a>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>, <code>, <pre>. No <img>, no <script>, no inline styles, no custom classes.',
      '5. Length target: 900–1200 words inside body_html.',
      '6. Structure: a tight 1-paragraph intro that names the problem this tutorial solves; 3–5 <h2> step sections with action-driven titles (e.g., "Step 1: ..."); use <ol> for sequential steps and <ul> for option lists where it helps comprehension; a closing paragraph with a SOFT call-to-action.',
      '7. CTA: in the closing paragraph, pick the ONE Yammbo product that is most relevant to the topic of THIS tutorial and mention it with its URL in a single helpful sentence. If no Yammbo product fits the topic cleanly, mention the company at https://yammbo.com instead. Available products:',
      productsList,
      '',
      'CATEGORY: This piece goes in the "Tutorials" section.',
      '',
      'OUTPUT: Return ONLY a valid JSON object with EXACTLY this shape — no extra prose, no markdown, no code fences:',
      '{',
      '  "title": string (50-70 chars, in English, descriptive — prefer verb-led or "How to" / "A guide to" patterns),',
      '  "slug": string (lowercase, ASCII, hyphen-separated, max 70 chars),',
      '  "excerpt": string (140-160 chars, English, summary),',
      '  "body_html": string (full tutorial HTML in English),',
      '  "focus_keyword": string (1-3 words in English, primary SEO keyword),',
      '  "secondary_keywords": [string] (3-5 supporting keywords in English),',
      '  "meta_description": string (150-160 chars, optimized for Google snippet, in English),',
      '  "image_search_query": string (2-5 English words for a generic stock photo — no brand names, no proper nouns)',
      '}',
    ].join('\n');
  } else {
    const brandSwapLines = Object.entries(rr.brand_swap_table)
      .map(([from, to]) => '   - ' + from + ' → ' + to)
      .join('\n');

    system = [
      'ROLE: You are a senior staff writer for the Yammbo SaaS company blog (blog.yammbo.com).',
      'Yammbo runs 5 products: Yammbo Music (music streaming), Yammbo Web (AI-powered website builder), Yammbo POS (restaurant point-of-sale + online ordering), Yammbo Store (online store builder), Yammbo Vcard (digital business cards + bio links).',
      '',
      'TASK: Completely rewrite the supplied source article as an original blog post in clear American English (en_US). The post must read as native Yammbo content — never as a rewrite or translation.',
      '',
      'STRICT RULES:',
      '1. NEVER mention or reference the source publication, the source URL, the source brand, or any of its writers.',
      '2. Replace EVERY mention of the following competitor brands with the matching Yammbo product:',
      brandSwapLines,
      '3. Do NOT frame Yammbo as a "competitor to" or "alternative to" anything; present it as the natural answer to the topic.',
      '4. ' + linkPolicyLines.join('\n'),
      '5. HTML must be Astra-theme compatible: ONLY <h2>, <h3>, <p>, <a>, <ul>, <ol>, <li>, <strong>, <em>, <blockquote>. No <img>, no <script>, no inline styles, no custom classes.',
      '6. Length target: 900–1200 words inside body_html.',
      '7. Structure: a strong 1–2 paragraph intro, 3–5 <h2> subsections, a <ul> where it adds value, and a closing paragraph with a soft call-to-action that names ' +
        vertical.brand +
        ' (' +
        vertical.site_url +
        ').',
      '',
      'CATEGORY: This piece goes in the "' +
        vertical.brand +
        '" section (' +
        vertical.wp_category_name +
        ').',
      '',
      'OUTPUT: Return ONLY a valid JSON object with EXACTLY this shape — no extra prose, no markdown, no code fences:',
      '{',
      '  "title": string (50-70 chars, in English, click-worthy without being clickbait),',
      '  "slug": string (lowercase, ASCII, hyphen-separated, max 70 chars),',
      '  "excerpt": string (140-160 chars, English, summary),',
      '  "body_html": string (full article HTML in English),',
      '  "focus_keyword": string (1-3 words in English, primary SEO keyword),',
      '  "secondary_keywords": [string] (3-5 supporting keywords in English),',
      '  "meta_description": string (150-160 chars, optimized for Google snippet, in English),',
      '  "image_search_query": string (2-5 English words for a generic stock photo — no brand names, no proper nouns)',
      '}',
    ].join('\n');
  }

  const user = [
    'SOURCE ARTICLE TO REWRITE (do NOT name the source publication or include its links):',
    '',
    'Original title (internal reference only): ' + source.title,
    '',
    'Original summary:',
    source.desc,
    '',
    'Original content (may contain stray HTML — ignore tags):',
    source.content,
  ].join('\n');

  return {
    contents: [{ role: 'user', parts: [{ text: system + '\n\n' + user }] }],
    generationConfig: {
      // gemini-2.5-flash is a thinking model: by default its reasoning tokens are
      // billed against maxOutputTokens. On complex tutorials the model spent most
      // of the budget "thinking" and hit MAX_TOKENS with the JSON still open (only
      // ~4.8k chars emitted). This is a deterministic rewrite-to-JSON task, so
      // disable thinking entirely — the whole budget goes to real output.
      thinkingConfig: { thinkingBudget: 0 },
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          title: { type: 'STRING' },
          slug: { type: 'STRING' },
          excerpt: { type: 'STRING' },
          body_html: { type: 'STRING' },
          focus_keyword: { type: 'STRING' },
          secondary_keywords: { type: 'ARRAY', items: { type: 'STRING' } },
          meta_description: { type: 'STRING' },
          image_search_query: { type: 'STRING' },
        },
        required: [
          'title',
          'slug',
          'excerpt',
          'body_html',
          'focus_keyword',
          'secondary_keywords',
          'meta_description',
          'image_search_query',
        ],
      },
      temperature: 0.6,
      // 16384 truncated long technical tutorials (HTML + code blocks inflate the
      // JSON-escaped output): Gemini hit MAX_TOKENS and returned an unclosed JSON
      // object → parse failure. gemini-2.5-flash caps at 65536; 32768 is ample.
      maxOutputTokens: 32768,
      topP: 0.9,
    },
  };
}

// ───────────────────────── 5. call Gemini rewrite ─────────────────────────
// Verified from the n8n "Call Gemini" HTTP node:
//   POST https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent
async function callGemini(env: Env, geminiRequest: any): Promise<any> {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' +
    env.GEMINI_MODEL +
    ':generateContent';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify(geminiRequest),
  });
  if (!resp.ok) throw new Error('Gemini HTTP ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  return await resp.json();
}

// ───────────────────────── 6. parse + sanitize + link audit ───────────────
// Ported from parse_gemini.js. node:https swapped for fetch.
interface PostObj {
  title: string;
  slug: string;
  excerpt: string;
  body_html: string;
  focus_keyword: string;
  secondary_keywords: string[];
  meta_description: string;
  image_search_query: string;
}

function hostOf(href: string): string | null {
  try {
    return new URL(href).hostname.toLowerCase();
  } catch {
    return null;
  }
}
function matchDomain(host: string | null, list: string[]): boolean {
  if (!host) return false;
  return list.some((dom) => host === dom || host.endsWith('.' + dom));
}
function isYouTube(host: string): boolean {
  return (
    host === 'youtu.be' ||
    host === 'youtube.com' ||
    host === 'www.youtube.com' ||
    host === 'm.youtube.com'
  );
}

async function fetchWithTimeout(url: string, opts: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal, redirect: 'follow' });
  } finally {
    clearTimeout(to);
  }
}

async function ytAuthorBlocked(url: string, blockedYTNames: string[], timeoutMs: number): Promise<boolean> {
  try {
    const oe = 'https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url);
    const r = await fetchWithTimeout(oe, { method: 'GET' }, timeoutMs);
    if (!r.ok) return false;
    const data: any = await r.json();
    const author = String(data.author_name || '').toLowerCase();
    return blockedYTNames.some((n) => author.includes(n));
  } catch {
    return false;
  }
}

async function liveCheck(url: string, timeoutMs: number): Promise<boolean> {
  // HTTPS-only, mirroring the n8n policy (TLS required).
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
  } catch {
    return false;
  }
  try {
    let r = await fetchWithTimeout(url, { method: 'HEAD' }, timeoutMs);
    if ([405, 501, 400, 403].includes(r.status)) {
      r = await fetchWithTimeout(url, { method: 'GET' }, timeoutMs);
    }
    return r.status >= 200 && r.status < 400;
  } catch {
    return false;
  }
}

async function parseGemini(geminiResponse: any): Promise<{ post: PostObj; link_audit: any }> {
  const cand = geminiResponse?.candidates?.[0];
  const finishReason = cand?.finishReason;
  const text = cand?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini response empty (finish=' + (finishReason || 'unknown') + ')');
  let obj: any;
  try {
    obj = JSON.parse(text);
  } catch {
    // MAX_TOKENS => the JSON was cut off mid-object (no closing brace). Surface a
    // diagnostic instead of the generic "No JSON" so the alert is actionable.
    if (finishReason === 'MAX_TOKENS') {
      throw new Error(
        'Gemini output truncated (MAX_TOKENS, ' + String(text).length + ' chars); raise maxOutputTokens'
      );
    }
    const m = String(text).match(/\{[\s\S]*\}/);
    if (!m) throw new Error('No JSON in Gemini output (finish=' + (finishReason || 'unknown') + '): ' + String(text).slice(0, 300));
    obj = JSON.parse(m[0]);
  }
  const required = ['title', 'slug', 'excerpt', 'body_html', 'focus_keyword', 'meta_description', 'image_search_query'];
  for (const k of required) if (!obj[k]) throw new Error('Missing field: ' + k);

  const policy = cfg.publishing.link_policy || {};
  const internalDomains: string[] = cfg.publishing.internal_link_only_domains || [];
  const allowExternal = policy.external_links_allowed === true;
  const headCheckEnabled = policy.head_check_enabled === true;
  const ytCheckEnabled = policy.youtube_oembed_check === true;
  const headTimeoutMs = Number(policy.head_check_timeout_ms) || 5000;
  const blockedDomains: string[] = (policy.blocked_domains || []).map((s: string) => String(s).toLowerCase());
  const blockedYTNames: string[] = (policy.blocked_brand_names_for_youtube || []).map((s: string) =>
    String(s).toLowerCase()
  );

  let html = String(obj.body_html);
  const aRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const linksList: { match: string; href: string; inner: string }[] = [];
  let mm: RegExpExecArray | null;
  while ((mm = aRegex.exec(html)) !== null) {
    linksList.push({ match: mm[0], href: mm[1], inner: mm[2] });
  }

  const decisions = await Promise.all(
    linksList.map(async (lk) => {
      const host = hostOf(lk.href);
      if (!host) return { ...lk, keep: false, reason: 'bad_url' };
      if (matchDomain(host, internalDomains)) return { ...lk, keep: true, reason: 'internal' };
      if (!allowExternal) return { ...lk, keep: false, reason: 'external_disabled' };
      if (matchDomain(host, blockedDomains)) return { ...lk, keep: false, reason: 'blocked_domain' };
      if (isYouTube(host) && ytCheckEnabled) {
        const blocked = await ytAuthorBlocked(lk.href, blockedYTNames, headTimeoutMs);
        if (blocked) return { ...lk, keep: false, reason: 'yt_author_blocked' };
      }
      if (headCheckEnabled) {
        const alive = await liveCheck(lk.href, headTimeoutMs);
        if (!alive) return { ...lk, keep: false, reason: 'head_failed' };
      }
      return { ...lk, keep: true, reason: 'ok' };
    })
  );

  const stats: any = { total: linksList.length, kept: 0, stripped: {} };
  for (const dec of decisions) {
    if (dec.keep) stats.kept += 1;
    else stats.stripped[dec.reason] = (stats.stripped[dec.reason] || 0) + 1;
    if (!dec.keep) html = html.split(dec.match).join(dec.inner);
  }

  html = html.replace(/<\/?(script|style|iframe|object|embed|form|input|button)[^>]*>/gi, '');
  html = html.replace(/\son\w+="[^"]*"/gi, '');

  let slug = String(obj.slug || obj.title)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
  if (!slug) slug = 'post-' + Date.now();

  return {
    link_audit: stats,
    post: {
      title: String(obj.title).trim(),
      slug,
      excerpt: String(obj.excerpt).trim(),
      body_html: html.trim(),
      focus_keyword: String(obj.focus_keyword).trim(),
      secondary_keywords: Array.isArray(obj.secondary_keywords) ? obj.secondary_keywords : [],
      meta_description: String(obj.meta_description).trim(),
      image_search_query: String(obj.image_search_query).trim(),
    },
  };
}

// ───────────────────────── 7. Nano Banana cover (16:9) ─────────────────────
// Replaces the old Pexels+canvas+sharp image-service. Clean conceptual
// illustration of the article topic — NO title text (Astro renders the title as
// the page H1; baking it in risked garbled words). Only the "YAMMBO" wordmark. PNG.
function buildCoverPrompt(post: PostObj): string {
  const topic = post.image_search_query || post.focus_keyword || post.title;
  return [
    'Wide 16:9 editorial cover illustration for a blog article.',
    'Subject: a clean, modern, conceptual illustration of the topic "' + topic + '".',
    'Style: professional flat/vector editorial illustration, generous negative space, a tasteful limited color palette, soft depth, looks designed by a human art director — NOT an AI-stock-photo look.',
    'No title text and no headline anywhere in the image — the illustration must stand on its own with no sentences, captions, or article title rendered.',
    'Branding: the ONLY text in the entire image is the wordmark "YAMMBO", small and tasteful in one corner, all caps, clean sans-serif, correctly spelled.',
    'No watermarks, no UI chrome, no photographic faces, no lorem-ipsum, no gibberish text, no labels. Output a single polished cover image.',
  ].join(' ');
}

async function callImagen(env: Env, prompt: string, aspectRatio: string): Promise<string> {
  const url =
    'https://generativelanguage.googleapis.com/v1beta/models/' + env.IMAGE_MODEL + ':generateContent';
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio } },
    }),
  });
  if (!resp.ok) throw new Error('Image gen HTTP ' + resp.status + ': ' + (await resp.text()).slice(0, 300));
  const j: any = await resp.json();
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p: any) => p?.inlineData?.data);
  if (!img) {
    const fr = j?.candidates?.[0]?.finishReason || 'unknown';
    throw new Error('Image gen no image (finish=' + fr + '): ' + JSON.stringify(j).slice(0, 250));
  }
  return img.inlineData.data as string;
}

// ───────────────────────── 8. build Astro markdown ─────────────────────────
// Ported from Build_markdown.js. Cover is now .png (Nano Banana), not .webp.
function buildMarkdown(post: PostObj): { md_content: string; md_path: string; image_path: string } {
  const slug = post.slug;
  const imageFileName = slug + '.png';
  const imagePath = 'public/images/' + imageFileName;
  const mdPath = 'src/content/blog/' + slug + '.md';

  const pubDate = new Date().toISOString();
  const yamlString = (s: any) => JSON.stringify(String(s ?? ''));
  const yamlList = (arr: any[]) => {
    if (!arr || arr.length === 0) return ' []';
    return arr.map((x) => '\n  - ' + JSON.stringify(String(x))).join('');
  };

  // tags from secondary_keywords: dedupe + lowercase + trim + cap 5.
  let tags: any[] = post.secondary_keywords || [];
  if (!Array.isArray(tags)) tags = [];
  tags = [...new Set(tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 5);

  const description = post.meta_description || post.excerpt || '';
  const body = post.body_html || '';

  // featured rotation: every 4th publish (day-of-year % 4 === 0) -> featured: "1".
  const dayOfYear = Math.floor(
    (Number(new Date()) - Number(new Date(new Date().getFullYear(), 0, 0))) / 86400000
  );
  const featuredValue = dayOfYear % 4 === 0 ? '1' : null;

  const lines: string[] = ['---', 'draft: false'];
  if (featuredValue) lines.push('featured: ' + JSON.stringify(featuredValue));
  lines.push(
    'title: ' + yamlString(post.title),
    'description: ' + yamlString(description),
    'authors:',
    '  - "Yammbo"',
    'pubDate: ' + pubDate,
    'license: cc-by-nc-sa-4-0',
    'tags:' + yamlList(tags),
    'image:',
    '  src: ' + yamlString('/images/' + imageFileName),
    '  alt: ' + yamlString(post.title),
    '---',
    ''
  );

  const frontmatter = lines.join('\n');
  const md = frontmatter + '\n' + body + '\n';
  return { md_content: md, md_path: mdPath, image_path: imagePath };
}

// ───────────────────────── 9. commit to GitHub (Git Data API) ──────────────
// Ported from Commit_to_GitHub.js. node:https swapped for fetch.
async function gh(env: Env, method: string, path: string, body?: any): Promise<any> {
  const resp = await fetch('https://api.github.com' + path, {
    method,
    headers: {
      Authorization: 'Bearer ' + env.GITHUB_TOKEN,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'yammbo-blog-worker',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await resp.text();
  if (resp.status < 200 || resp.status >= 300) {
    throw new Error('GH ' + method + ' ' + path + ' -> ' + resp.status + ' ' + txt.slice(0, 400));
  }
  try {
    return JSON.parse(txt);
  } catch {
    throw new Error('Bad JSON from GH: ' + txt.slice(0, 200));
  }
}

async function commitToGitHub(
  env: Env,
  args: { md_path: string; md_content: string; image_path: string; image_base64: string; post_title: string; slug: string }
): Promise<{ commit_sha: string; commit_url: string; post_url: string }> {
  const REPO = env.GITHUB_REPO;
  const BRANCH = env.GITHUB_BRANCH;
  const { md_path, md_content, image_path, image_base64, post_title, slug } = args;

  const ref = await gh(env, 'GET', '/repos/' + REPO + '/git/refs/heads/' + BRANCH);
  const parentSha = ref.object.sha;

  const parentCommit = await gh(env, 'GET', '/repos/' + REPO + '/git/commits/' + parentSha);
  const parentTreeSha = parentCommit.tree.sha;

  const mdBlob = await gh(env, 'POST', '/repos/' + REPO + '/git/blobs', {
    content: md_content,
    encoding: 'utf-8',
  });
  const imgBlob = await gh(env, 'POST', '/repos/' + REPO + '/git/blobs', {
    content: image_base64,
    encoding: 'base64',
  });

  const tree = await gh(env, 'POST', '/repos/' + REPO + '/git/trees', {
    base_tree: parentTreeSha,
    tree: [
      { path: md_path, mode: '100644', type: 'blob', sha: mdBlob.sha },
      { path: image_path, mode: '100644', type: 'blob', sha: imgBlob.sha },
    ],
  });

  const commitMsg = 'Publish: ' + post_title + ' (' + slug + ')\n\nAuto-posted by yammbo-blog worker';
  const newCommit = await gh(env, 'POST', '/repos/' + REPO + '/git/commits', {
    message: commitMsg,
    tree: tree.sha,
    parents: [parentSha],
  });

  await gh(env, 'PATCH', '/repos/' + REPO + '/git/refs/heads/' + BRANCH, {
    sha: newCommit.sha,
    force: false,
  });

  return {
    commit_sha: newCommit.sha,
    commit_url: 'https://github.com/' + REPO + '/commit/' + newCommit.sha,
    post_url: 'https://blog.yammbo.com/blog/' + slug + '/',
  };
}

// ───────────────────────── KV dedupe doc helpers ─────────────────────────
async function loadDedupe(env: Env): Promise<DedupeDoc> {
  const raw = await env.BLOG_DEDUPE.get(DEDUPE_KEY);
  let sd: DedupeDoc;
  if (raw) {
    try {
      sd = JSON.parse(raw);
    } catch {
      sd = { published_titles: [], published_links: [] };
    }
  } else {
    sd = { published_titles: [], published_links: [] };
  }
  sd.published_titles = sd.published_titles || [];
  sd.published_links = sd.published_links || [];

  // Bootstrap from SEED ONLY if the doc is empty (fresh namespace). The
  // production namespace is already pre-seeded, so this is a no-op there.
  if (!sd.bootstrapped && sd.published_titles.length === 0) {
    for (const t of SEED_TITLES) {
      if (!sd.published_titles.includes(t)) sd.published_titles.push(t);
    }
    sd.bootstrapped = true;
    sd.bootstrap_at = new Date().toISOString();
    await env.BLOG_DEDUPE.put(DEDUPE_KEY, JSON.stringify(sd));
  }
  return sd;
}

async function persistDedupe(env: Env, sd: DedupeDoc, source: Picked, post: PostObj, verticalKey: string): Promise<void> {
  sd.published_titles = sd.published_titles || [];
  sd.published_links = sd.published_links || [];

  if (source && source.link && !sd.published_links.includes(source.link)) {
    sd.published_links.push(source.link);
  }
  if (post && post.title) {
    const tn = norm(post.title);
    if (!sd.published_titles.includes(tn)) sd.published_titles.push(tn);
  }
  sd.last_publish_ts = new Date().toISOString();
  sd.last_publish_vertical = verticalKey;
  sd.last_publish_title = post?.title ?? null;
  if (sd.published_titles.length > 2000) sd.published_titles = sd.published_titles.slice(-2000);
  if (sd.published_links.length > 2000) sd.published_links = sd.published_links.slice(-2000);

  await env.BLOG_DEDUPE.put(DEDUPE_KEY, JSON.stringify(sd));
}

// ───────────────────────── main pipeline ─────────────────────────
async function runPipeline(env: Env, kind: 'blog' | 'tutorial', dryRun: boolean): Promise<any> {
  const { verticalKey, vertical } = pickVertical(kind);
  console.log('STEP pick', kind, verticalKey);

  // Fetch all feeds in parallel, parse, flatten.
  const xmls = await Promise.all((vertical.feeds as string[]).map((f) => fetchFeed(f)));
  let all: FeedItem[] = [];
  vertical.feeds.forEach((f: string, i: number) => {
    all = all.concat(parseFeed(f, xmls[i]));
  });
  console.log('STEP parsed items:', all.length);

  const sd = await loadDedupe(env);
  const { picked, reason, debug } = dedupePickTop(all, sd);
  if (!picked) {
    console.log('STEP skip:', reason, JSON.stringify(debug));
    return { skip: true, reason, kind, vertical: verticalKey, ...debug };
  }
  console.log('STEP picked:', picked.title, 'score', picked._score);

  const geminiRequest = buildGeminiRequest(vertical, picked);
  const geminiResponse = await callGemini(env, geminiRequest);
  const { post, link_audit } = await parseGemini(geminiResponse);
  console.log('STEP gemini ok:', post.title, 'links kept', link_audit.kept, '/', link_audit.total);

  const coverPrompt = buildCoverPrompt(post);
  const coverB64 = await callImagen(env, coverPrompt, '16:9');
  console.log('STEP cover ok bytes:', coverB64.length);

  const { md_content, md_path, image_path } = buildMarkdown(post);

  const result: any = {
    kind,
    vertical: verticalKey,
    title: post.title,
    slug: post.slug,
    tags: [...new Set((post.secondary_keywords || []).map((t) => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 5),
    md_chars: md_content.length,
    link_audit,
    pick_score: picked._score,
    dryRun,
  };

  if (dryRun) {
    // Preview only: do NOT commit, do NOT mutate KV. Return the cover as base64.
    result.cover_base64 = coverB64;
    return result;
  }

  const commit = await commitToGitHub(env, {
    md_path,
    md_content,
    image_path,
    image_base64: coverB64,
    post_title: post.title,
    slug: post.slug,
  });
  console.log('STEP committed:', commit.commit_url);

  await persistDedupe(env, sd, picked, post, verticalKey);
  console.log('STEP dedupe persisted');

  result.commit_sha = commit.commit_sha;
  result.commit_url = commit.commit_url;
  result.post_url = commit.post_url;
  return result;
}

// Map a cron / UTC hour to the run kind. 15:00 -> blog, 21:00 -> tutorial.
function kindForCron(event: ScheduledController): 'blog' | 'tutorial' {
  const cron = (event as any).cron as string | undefined;
  if (cron === '0 21 * * *') return 'tutorial';
  if (cron === '0 15 * * *') return 'blog';
  return new Date().getUTCHours() >= 21 ? 'tutorial' : 'blog';
}

async function alertTelegram(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  try {
    await fetch('https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/sendMessage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML' }),
    });
  } catch {
    /* swallow */
  }
}

// ───────────────────────── handlers ─────────────────────────
export default {
  async scheduled(event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    // await (not waitUntil): the scheduled invocation gets the full duration
    // budget; the pipeline (feeds + Gemini + image + GitHub) is long.
    const kind = kindForCron(event);
    try {
      const r = await runPipeline(env, kind, false);
      if (r.skip) {
        await alertTelegram(
          env,
          '🟡 <b>BLOG SKIP</b> (' + kind + '/' + r.vertical + ')\nreason: ' + r.reason
        );
      }
    } catch (e: any) {
      await alertTelegram(
        env,
        '🟠 <b>BLOG PUBLISH FAILED</b> (' + kind + ')\n' + String(e?.message || e).slice(0, 400)
      );
    }
  },

  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const seg = url.pathname.replace(/^\/+/, '');

    if (req.method === 'GET' && seg === '') return new Response('yammbo-blog ok', { status: 200 });

    // Manual trigger: POST /run?mode=dry|real&kind=blog|tutorial  (x-run-key auth)
    if (req.method === 'POST' && seg === 'run') {
      if (!env.RUN_KEY || req.headers.get('x-run-key') !== env.RUN_KEY) {
        return new Response('forbidden', { status: 403 });
      }
      const kind = url.searchParams.get('kind') === 'tutorial' ? 'tutorial' : 'blog';
      const dry = url.searchParams.get('mode') !== 'real';
      try {
        const r = await runPipeline(env, kind, dry);
        return new Response(JSON.stringify(r, null, 2), {
          headers: { 'content-type': 'application/json' },
        });
      } catch (e: any) {
        return new Response('error: ' + (e?.message || e), { status: 500 });
      }
    }

    return new Response('method not allowed', { status: 405 });
  },
};
