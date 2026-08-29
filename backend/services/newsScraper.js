const axios = require('axios');
const xml2js = require('xml2js');
const cheerio = require('cheerio');
// The shared client, not a second one built here on the anon key. That private
// client predated services/supabase.js and would have kept dedupe running on a
// key that reads nothing once RLS is enabled — and outside the reach of the
// production fail-closed check.
const { getSupabase } = require('./supabase');

// Dedupe memory is per account. A story one account posted stays available to
// every other account, so each of these queries is scoped by slug — reads,
// writes and the retention sweep alike. An unscoped query here would silently
// restore the old global behaviour the moment a second account exists.
const RETENTION_PER_ACCOUNT = 100;

function requireAccount(account, fn) {
  if (!account?.slug) {
    throw new Error(`[News] ${fn} requires an account (see services/accounts.js)`);
  }
  return account.slug;
}

/**
 * URLs this account has already posted.
 *
 * A failed read used to return an empty set, which reads as "nothing has been
 * posted" and invites publishing a story again. An Instagram post cannot be
 * edited or quietly removed, so a duplicate on the grid is permanent while a
 * failed run is not. This throws instead.
 */
async function loadHistory(account) {
  const slug = requireAccount(account, 'loadHistory');
  const db = getSupabase();
  if (!db) return new Set();

  const { data, error } = await db
    .from('posted_urls')
    .select('url')
    .eq('account', slug);

  if (error) {
    throw new Error(
      `[News] could not read posting history for "${slug}" (${error.message}). ` +
      'Refusing to continue: an empty history here would republish stories.',
    );
  }
  return new Set((data || []).map((r) => r.url));
}

/**
 * URLs another account posted recently.
 *
 * Dedupe is per account by design, so nothing stops two handles running the same
 * headline in the same cycle. That is an overlap policy question, not a dedupe
 * one, and it gets its own knob: a story another account published inside the
 * cooldown is held back rather than being permanently unavailable.
 *
 * Set CROSS_ACCOUNT_COOLDOWN_HOURS=0 to let accounts overlap freely.
 */
const DEFAULT_COOLDOWN_HOURS = 24;

/**
 * Hours of cross-account cooldown. Only an explicit, valid number disables it.
 *
 * Number('') is 0 and Number('abc') is NaN, so the obvious parse turns a typo,
 * an empty variable or a negative value into "protection off" — silently, and
 * in the direction that lets two handles post the same headline.
 */
function cooldownHours() {
  const raw = process.env.CROSS_ACCOUNT_COOLDOWN_HOURS;
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_COOLDOWN_HOURS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.warn(
      `[News] ignoring invalid CROSS_ACCOUNT_COOLDOWN_HOURS="${raw}" — ` +
      `falling back to ${DEFAULT_COOLDOWN_HOURS}h rather than disabling the cooldown.`,
    );
    return DEFAULT_COOLDOWN_HOURS;
  }
  return n;
}

// Stories this process published but could not record. A failed write means the
// database cannot warn the next account off, so they are held here for the
// cooldown window as well. In memory only: it covers the rest of this process,
// which is what the next account in the same fan-out needs.
const unrecorded = new Map();

function rememberUnrecorded(url) {
  unrecorded.set(url, Date.now());
}

function pruneUnrecorded(windowMs) {
  const cutoff = Date.now() - windowMs;
  for (const [url, at] of unrecorded) if (at < cutoff) unrecorded.delete(url);
}

async function loadCrossAccountRecent(account) {
  const slug = requireAccount(account, 'loadCrossAccountRecent');
  const hours = cooldownHours();
  if (hours === 0) return new Set();

  pruneUnrecorded(hours * 3600 * 1000);

  const db = getSupabase();
  // With no database the in-memory set is the only protection there is.
  if (!db) return new Set(unrecorded.keys());

  const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data, error } = await db
    .from('posted_urls')
    .select('url')
    .neq('account', slug)
    .gte('posted_at', since);

  if (error) {
    // Same reasoning as loadHistory: reading this as "nothing to avoid" is how
    // two handles end up posting the same headline an hour apart.
    throw new Error(
      `[News] could not read the cross-account cooldown for "${slug}" (${error.message}). ` +
      'Refusing to continue rather than risk two accounts posting the same story.',
    );
  }
  return new Set([...(data || []).map((r) => r.url), ...unrecorded.keys()]);
}

/**
 * Everything this account must not pick: its own history, plus whatever another
 * account posted inside the cooldown window.
 */
async function loadExclusions(account) {
  const [own, others] = await Promise.all([
    loadHistory(account),
    loadCrossAccountRecent(account),
  ]);
  for (const url of others) own.add(url);
  return own;
}

/**
 * Has this account already published since `since`?
 *
 * The double-fire guard this backs up is a Map in memory, and on a free tier
 * that sleeps between triggers the process rarely survives from one firing to
 * the next — so the guard is usually empty exactly when a second trigger for the
 * same slot arrives. The posting history is the only record that outlives a
 * restart, so it is what answers "have we already covered this slot".
 *
 * Errors propagate for the same reason as loadHistory: reading a failure as "no,
 * go ahead" is how the same story goes out twice, and an Instagram post cannot
 * be taken back.
 */
async function postedSince(account, since) {
  const slug = requireAccount(account, 'postedSince');
  const db = getSupabase();
  // With no database the in-memory guard in the scheduler is all there is.
  if (!db) return false;

  const { data, error } = await db
    .from('posted_urls')
    .select('id')
    .eq('account', slug)
    .gte('posted_at', new Date(since).toISOString())
    .limit(1);

  if (error) {
    throw new Error(
      `[News] could not check whether "${slug}" already posted this slot (${error.message}). ` +
      'Refusing to continue rather than risk a second post in the same slot.',
    );
  }
  return (data || []).length > 0;
}

async function markPosted(url, account) {
  const slug = requireAccount(account, 'markPosted');
  const db = getSupabase();
  if (!db) {
    console.log('[Supabase] Not configured — skipping markPosted. Check SUPABASE_URL and the service-role key.');
    return { ok: false, skipped: true };
  }
  try {
    console.log(`[Supabase] Saving URL for ${slug}: ${url}`);
    // Conflict target is the (account, url) unique index, so re-marking the same
    // story for the same account updates rather than erroring, and the same URL
    // can still be recorded against a different account.
    const { error } = await db
      .from('posted_urls')
      .upsert(
        { url, account: slug, posted_at: new Date().toISOString() },
        { onConflict: 'account,url' },
      );
    if (error) {
      // Stop here. The carousel is already on Instagram but this URL is not in
      // the history, so the story can be picked again. Trimming the oldest rows
      // on top of that would discard memory that is still doing its job and
      // widen the window for a repost. Nothing to do but say so loudly.
      console.error(
        `[Supabase] ✗ FAILED to record ${url} for ${slug}: ${error.message}\n` +
        '           The post went out but is NOT in the dedupe history — it can be picked again. ' +
        'Skipping retention so no further memory is lost.',
      );
      rememberUnrecorded(url);
      return { ok: false, error: error.message };
    }
    console.log('[Supabase] URL saved successfully.');

    // Retention is per account: one busy account must not evict another's memory.
    const { data, error: readErr } = await db
      .from('posted_urls')
      .select('id')
      .eq('account', slug)
      .order('posted_at', { ascending: true });
    if (readErr) {
      // The URL is recorded, which is the part that matters. Leaving the table
      // slightly over the cap is harmless.
      console.error('[Supabase] retention read error:', readErr.message);
      return { ok: true, retentionSkipped: true };
    }
    if (data && data.length > RETENTION_PER_ACCOUNT) {
      const idsToDelete = data.slice(0, data.length - RETENTION_PER_ACCOUNT).map((r) => r.id);
      // Scoped as well as id-filtered. The ids came from a scoped read, so this
      // is belt and braces — but a delete that is only transitively safe is one
      // refactor away from clearing another account's memory.
      await db.from('posted_urls').delete().eq('account', slug).in('id', idsToDelete);
    }
    return { ok: true };
  } catch (e) {
    console.error('[Supabase] markPosted exception:', e.message);
    rememberUnrecorded(url);
    return { ok: false, error: e.message };
  }
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

const BLOCKED_DOMAINS = [
  'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com',
  'reddit.com', 'redd.it', 'quora.com', 'medium.com', 'substack.com',
  'linkedin.com', 'youtube.com', 'youtu.be', 'github.com', 'docs.google.com',
];

// Only allow established news/tech publications — blocks personal blogs automatically
const TRUSTED_DOMAINS = [
  'techcrunch.com', 'venturebeat.com', 'theverge.com', 'wired.com',
  'arstechnica.com', 'technologyreview.com', 'bbc.com', 'bbc.co.uk',
  'reuters.com', 'bloomberg.com', 'wsj.com', 'nytimes.com', 'ft.com',
  'cnbc.com', 'forbes.com', 'businessinsider.com', 'fortune.com',
  'washingtonpost.com', 'theguardian.com', 'engadget.com', 'zdnet.com',
  'cnet.com', 'tomshardware.com', 'anandtech.com', 'semafor.com',
  'theatlantic.com', 'axios.com', 'protocol.com', 'infoq.com',
  'thenextweb.com', 'fastcompany.com', 'inc.com', 'entrepreneur.com',
  'nature.com', 'science.org', 'newscientist.com', 'scientificamerican.com',
  'apnews.com', 'politico.com', 'npr.org', 'thehill.com', 'marketwatch.com',
  'nvidia.com', 'openai.com', 'anthropic.com', 'deepmind.com', 'google.com',
  'microsoft.com', 'meta.com', 'apple.com', 'amazon.com',
  // Indian outlets — the only sources that reliably carry visa/immigration
  // news for Indian workers and students. Verified to scrape with og:image.
  'economictimes.indiatimes.com', 'timesofindia.indiatimes.com',
  'hindustantimes.com', 'livemint.com', 'thehindu.com', 'indianexpress.com',
  // International-education trade press, and the rule as published.
  'thepienews.com', 'federalregister.gov',
];

// Keywords that indicate opinion/blog posts — not real news
const OPINION_SIGNALS = [
  'my thoughts', 'i think', 'i believe', 'opinion:', 'perspective:',
  'were you recently laid off', 'helpful thoughts', 'survival guide',
  'dear diary', 'personal story', 'my experience', 'how i ', 'why i ',
  'letter to', 'an open letter', 'reflections on', 'musings',
];

// ── RSS FEEDS ──────────────────────────────────────────────────────────────
const RSS_FEEDS = [
  { name: 'TechCrunch AI',     url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'VentureBeat AI',    url: 'https://venturebeat.com/category/ai/feed/' },
  { name: 'Ars Technica',      url: 'https://feeds.arstechnica.com/arstechnica/technology-lab' },
  { name: 'The Verge AI',      url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { name: 'Wired AI',          url: 'https://www.wired.com/feed/tag/ai/latest/rss' },
  { name: 'MIT Tech Review',   url: 'https://www.technologyreview.com/feed/' },
  { name: 'TechCrunch',        url: 'https://techcrunch.com/feed/' },
  { name: 'BBC Tech',          url: 'https://feeds.bbci.co.uk/news/technology/rss.xml' },
  { name: 'The Verge',         url: 'https://www.theverge.com/rss/index.xml' },
  { name: 'Wired',             url: 'https://www.wired.com/feed/rss' },
];

// ── HACKERNEWS ALGOLIA SEARCH ────────────────────────────────────────────────
async function searchHN(query) {
  try {
    const since = Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60;
    const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${since},points>30&hitsPerPage=10`;
    const res = await axios.get(url, { timeout: 8000 });
    return res.data.hits
      .filter((h) => h.url && !h.url.includes('ycombinator.com'))
      .map((h) => ({
        title:    h.title,
        url:      h.url,
        pubDate:  h.created_at,
        summary:  h.story_text || '',
        source:   'HackerNews',
        hnPoints: h.points || 0,
        redditScore: 0,
      }));
  } catch { return []; }
}

// ── HACKERNEWS TOP STORIES (front page right now) ────────────────────────────
async function fetchHNTopStories() {
  try {
    // Get top 50 story IDs from HN front page
    const idsRes = await axios.get('https://hacker-news.firebaseio.com/v0/topstories.json', { timeout: 8000 });
    const ids = idsRes.data.slice(0, 50);

    // Fetch story details in parallel (batches of 10)
    const stories = [];
    for (let i = 0; i < ids.length; i += 10) {
      const batch = ids.slice(i, i + 10);
      const details = await Promise.all(
        batch.map((id) =>
          axios.get(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, { timeout: 5000 })
            .then((r) => r.data)
            .catch(() => null)
        )
      );
      stories.push(...details.filter(Boolean));
    }

    return stories
      .filter((s) => s && s.url && s.title && s.type === 'story')
      .map((s) => ({
        title:    s.title,
        url:      s.url,
        pubDate:  new Date(s.time * 1000).toISOString(),
        summary:  s.text || '',
        source:   'HackerNews Top',
        hnPoints: s.score || 0,
        redditScore: 0,
      }));
  } catch (e) {
    console.log(`[HN Top] Failed: ${e.message}`);
    return [];
  }
}

// ── RSS PARSER ──────────────────────────────────────────────────────────────
async function fetchRSSFeed(feed) {
  try {
    const res = await axios.get(feed.url, { timeout: 8000, headers: HEADERS });
    const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false });
    let items = [];

    if (parsed.rss?.channel?.item) {
      const raw = parsed.rss.channel.item;
      items = Array.isArray(raw) ? raw : [raw];
    } else if (parsed.feed?.entry) {
      const raw = parsed.feed.entry;
      items = (Array.isArray(raw) ? raw : [raw]).map((e) => ({
        title:       typeof e.title === 'object' ? e.title._ : e.title,
        link:        typeof e.link  === 'object' ? (e.link.$?.href || e.link) : e.link,
        pubDate:     e.published || e.updated,
        description: typeof e.summary === 'object' ? e.summary._ : (e.summary || ''),
      }));
    }

    return items.map((item) => {
      // Reddit RSS wraps the real URL inside <span><a href="...">
      let url = typeof item.link === 'object' ? item.link._ : (item.link || '');
      if (feed.name.startsWith('Reddit') && item.link) {
        const match = String(item.description || '').match(/href="(https?:\/\/[^"]+)"/);
        if (match) url = match[1];
      }

      // Reddit score from title prefix e.g. "[1234 points]"
      const redditScore = feed.name.startsWith('Reddit')
        ? parseInt((String(item.title || '')).match(/\[(\d+)\s+point/)?.[1] || '0')
        : 0;

      return {
        title:      typeof item.title === 'object' ? item.title._ : (item.title || ''),
        url,
        pubDate:    item.pubDate || item.published || '',
        summary:    String(item.description || item.summary || '').replace(/<[^>]+>/g, '').slice(0, 300),
        source:     feed.name,
        redditScore,
        hnPoints:   0,
      };
    }).filter((i) => i.url && i.title);

  } catch (e) {
    console.log(`[RSS] Failed ${feed.name}: ${e.message}`);
    return [];
  }
}

// ── SCORING ─────────────────────────────────────────────────────────────────
const AI_KEYWORDS = [
  'openai', 'anthropic', 'claude', 'gpt', 'gemini', 'llm', 'chatgpt',
  'artificial intelligence', ' ai ', 'machine learning', 'deep learning',
  'neural network', 'layoff', 'fired', 'laid off', 'funding', 'billion',
  'regulation', 'model release', 'robot', 'automation', 'agi', 'nvidia',
  'google ai', 'meta ai', 'microsoft ai', 'apple intelligence', 'salary',
  'hired', 'hiring', 'package', 'researcher', 'executive', 'breakthrough',
  'course', 'education', 'training', 'job', 'career', 'replace',
];

function scoreArticle(item, topic) {
  const text = (item.title + ' ' + item.summary).toLowerCase();
  const topicWords = topic.toLowerCase().split(/\s+/);
  let score = 0;

  // Full phrase match — biggest signal
  if (text.includes(topic.toLowerCase())) score += 60;

  // Individual topic word matches
  for (const word of topicWords) {
    if (word.length > 3 && text.includes(word)) score += 25;
  }

  // AI keyword relevance
  for (const kw of AI_KEYWORDS) {
    if (text.includes(kw)) score += 3;
  }

  // Virality signals
  score += Math.min(item.hnPoints / 2, 40);    // HN points (capped at 40)
  score += Math.min(item.redditScore / 5, 30); // Reddit score (capped at 30)

  // Freshness — strongly prefer recent articles
  if (item.pubDate) {
    const days = (Date.now() - new Date(item.pubDate).getTime()) / (1000 * 60 * 60 * 24);
    if (days < 1)       score += 50;
    else if (days < 3)  score += 35;
    else if (days < 7)  score += 20;
    else if (days < 30) score += 8;
    else score -= 20; // penalise older articles
  }

  return score;
}

// Newsletter/app-promo lines that survive extraction on Indian news sites and
// look like article text to a length check.
const BOILERPLATE_PATTERNS = [
  /join our .{0,40}whatsapp channel/i,
  /catch all the .{0,60}news/i,
  /subscribe to .{0,40}(prime|epaper|newsletter)/i,
  /read the .{0,20}epaper online/i,
  /download the .{0,30}app/i,
  /click here to .{0,40}(subscribe|download)/i,
  /this article was generated/i,
  /all rights reserved/i,
];

// The minimum body a carousel may be written from.
//
// This exists because the old bar was 200 characters, and a paywalled article
// that yielded 224 characters of pure newsletter boilerplate cleared it. The
// model was then asked to write 90 words from a headline and invented every
// specific in the post -- percentages, dollar figures, dates, company names.
// For visa and immigration news that is not a cosmetic bug: people make
// immigration decisions on these numbers.
const MIN_ARTICLE_CHARS = Number(process.env.MIN_ARTICLE_CHARS || 800);

// Strip the promo lines, then report whether real reporting is left.
//
// Filtering is per sentence, not per line, because Times of India publishes an
// entire article as one unbroken line with "Catch all the ... news" tacked on
// the end. Dropping the whole line took the reporting with it, the article read
// as empty, and the visa slot fell through to off-topic news — the promo phrase
// has to go without the paragraph it is attached to.
function stripBoilerplate(text) {
  return String(text || '')
    .split(/\n+/)
    .map((line) => line
      .trim()
      .split(/(?<=[.!?])\s+/)
      .filter((sentence) => sentence && !BOILERPLATE_PATTERNS.some((re) => re.test(sentence)))
      .join(' ')
      .trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}
function hasRealContent(text) {
  return stripBoilerplate(text).length >= MIN_ARTICLE_CHARS;
}

// Some outlets publish the reporting only as JSON-LD, and Times of India
// publishes it nowhere else at all. Read before the DOM is stripped: this lives
// in a <script>, which the cleanup below removes.
//
// The block can be a bare object, an array, or an @graph wrapper, so every
// nested object is visited rather than guessing the shape.
function jsonLdArticleBody($) {
  let best = '';
  $('script[type="application/ld+json"]').each((_, el) => {
    let parsed;
    try {
      parsed = JSON.parse($(el).contents().text());
    } catch {
      return; // A malformed block is one source among several, not a failure.
    }
    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 8) return;
      if (Array.isArray(node)) { for (const n of node) visit(n, depth + 1); return; }
      if (typeof node.articleBody === 'string' && node.articleBody.length > best.length) {
        best = node.articleBody;
      }
      for (const v of Object.values(node)) visit(v, depth + 1);
    };
    visit(parsed, 0);
  });
  // Occasionally the field carries escaped markup rather than plain text.
  return best.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
}

// ── ARTICLE SCRAPER ──────────────────────────────────────────────────────────
//
// Where an outlet keeps the article body varies, and taking the first container
// that happens to match is how a 3,800-character report gets read as 224
// characters: Economic Times renders <article><p> as a promo teaser and puts the
// reporting in JSON-LD, while Times of India uses neither <article> nor <p>.
// Under the old first-match rule both scraped short, failed the content floor,
// and the visa pool silently collapsed to whichever single outlet still worked —
// which is what pushed a visa-planned slot onto off-topic tech news.
//
// So every known location is read and the longest real body wins. Boilerplate is
// discounted while comparing, because a promo block can easily be longer than
// the reporting it sits above.
async function scrapeArticle(url) {
  const res = await axios.get(url, { timeout: 10000, headers: HEADERS });
  return extractArticleText(res.data);
}

// Split from the fetch so the selection rules can be tested against real page
// shapes without the network deciding whether the test passes.
function extractArticleText(html) {
  const $ = cheerio.load(html);

  // Grab og:image before removing elements
  const ogImage = $('meta[property="og:image"]').attr('content')
    || $('meta[name="twitter:image"]').attr('content')
    || null;

  const candidates = [];
  const fromJsonLd = jsonLdArticleBody($);
  if (fromJsonLd) candidates.push(fromJsonLd);

  $('script, style, nav, header, footer, aside, .ad, .advertisement, .related, .comments, .sidebar, .menu').remove();

  const selectors = [
    'article p', '[data-testid="article-body"] p', '.article-body p',
    '.article-content p', '.story-body p', '.post-content p',
    '.entry-content p', '.content p', 'main p', '[role="main"] p',
  ];

  for (const sel of selectors) {
    const paragraphs = $(sel).map((_, el) => $(el).text().trim()).get().filter((t) => t.length > 50);
    if (paragraphs.length >= 3) candidates.push(paragraphs.slice(0, 12).join('\n\n'));
  }

  const all = $('p').map((_, el) => $(el).text().trim()).get().filter((t) => t.length > 60);
  if (all.length) candidates.push(all.slice(0, 10).join('\n\n'));

  let text = '';
  let bestLength = -1;
  for (const candidate of candidates) {
    const real = stripBoilerplate(candidate).length;
    if (real > bestLength) { bestLength = real; text = candidate; }
  }

  return { text, ogImage };
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────────
async function fetchNewsArticle(topic, exclude = [], account) {
  console.log(`[News] Fetching viral news — topic: "${topic}"`);

  // Topic-specific tag feeds (TechCrunch supports tag RSS).
  // VentureBeat retired its /tag/{slug}/feed/ endpoints (they 404); its AI
  // coverage still comes through the category feed in the general pool above.
  const slug = topic.toLowerCase().trim().replace(/\s+/g, '-');
  const topicFeeds = [
    { name: `TechCrunch:${topic}`,  url: `https://techcrunch.com/tag/${slug}/feed/` },
  ];

  // HN queries for this topic
  const hnQueryWords = topic.split(/\s+/).slice(0, 3).join(' ');

  // Fetch everything in parallel
  const [rssResults, topicRssResults, hnItems, hnTopItems] = await Promise.all([
    Promise.all(RSS_FEEDS.map(fetchRSSFeed)),
    Promise.all(topicFeeds.map(fetchRSSFeed)),
    searchHN(hnQueryWords),
    fetchHNTopStories(),
  ]);

  const allItems = [...topicRssResults.flat(), ...hnItems, ...hnTopItems, ...rssResults.flat()];
  console.log(`[News] Total raw articles: ${allItems.length}`);

  // Filter, deduplicate, score
  const history    = await loadExclusions(account);
  const excludeSet = new Set(exclude);
  const seen       = new Set();

  const THIS_YEAR = new Date().getFullYear();
  const SIX_MONTHS_AGO = Date.now() - 180 * 24 * 60 * 60 * 1000;

  const candidates = allItems
    .filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      if (history.has(item.url) || excludeSet.has(item.url)) return false;
      try {
        const host = new URL(item.url).hostname.replace('www.', '');
        if (BLOCKED_DOMAINS.some((d) => host.includes(d))) return false;
        // Must be from a trusted news source — rejects personal blogs, random sites
        if (!TRUSTED_DOMAINS.some((d) => host.includes(d))) return false;
      } catch { return false; }
      // Strict date filter — must have a date AND be from this year
      if (!item.pubDate) return false;
      const parsed = new Date(item.pubDate);
      if (isNaN(parsed.getTime())) return false;
      if (parsed.getFullYear() < THIS_YEAR) return false;
      seen.add(item.url);
      return true;
    })
    .map((item) => ({ ...item, score: scoreArticle(item, topic) }))
    .sort((a, b) => b.score - a.score);

  console.log(`[News] ${candidates.length} unique candidates after filtering`);
  if (!candidates.length) throw new Error('No fresh articles found. Try a different topic.');

  // Try top candidates — scrape for full text
  for (const item of candidates.slice(0, 10)) {
    console.log(`[News] Trying: "${item.title}" (score:${item.score} hn:${item.hnPoints} r:${item.redditScore}) @ ${item.source}`);
    try {
      const { text: fullText, ogImage } = await scrapeArticle(item.url);
      if (hasRealContent(fullText)) {
        // Reject opinion pieces / personal blogs
        const lowerText = fullText.slice(0, 500).toLowerCase();
        const isOpinion = OPINION_SIGNALS.some((s) => lowerText.includes(s));
        if (isOpinion) {
          console.log(`[News] Skipping opinion/blog piece: "${item.title}"`);
          continue;
        }
        console.log(`[News] Got "${item.title}" — ${fullText.length} chars, image: ${ogImage ? 'yes' : 'no'}`);
        return { title: item.title, url: item.url, source: item.source, pubDate: item.pubDate, fullText, ogImage, points: item.score };
      }
    } catch (e) {
      console.log(`[News] Scrape failed ${item.source}: ${e.message}`);
    }
  }

  // No title-only fallback. Handing the model a headline with no body is how
  // fabricated specifics get written, so a run with nothing scrapable fails
  // loudly instead of publishing invention.
  throw new Error(
    `Found ${candidates.length} candidates but none had at least ${MIN_ARTICLE_CHARS} characters of real article text.`,
  );
}

// ── TRENDING: pick best AI/tech story from HN front page ─────────────────────
const TECH_AI_KEYWORDS = [
  'ai', 'openai', 'anthropic', 'google', 'meta', 'microsoft', 'nvidia',
  'llm', 'gpt', 'claude', 'gemini', 'model', 'robot', 'automation',
  'layoff', 'fired', 'hired', 'funding', 'startup', 'raises', 'billion',
  'apple', 'amazon', 'tesla', 'tech', 'software', 'developer', 'engineer',
  'machine learning', 'deep learning', 'data', 'chip', 'gpu', 'compute',
];

// HN's front page rarely carries a trusted, scrapable news story (mostly blogs,
// GitHub, or paywalled sites), so when the trending path comes up empty the
// autopilot falls back to the reliable RSS news pool the manual flow uses,
// rotating topics for variety so it doesn't post the same angle every run.
const FALLBACK_TOPICS = [
  'AI', 'OpenAI', 'artificial intelligence', 'startups',
  'cybersecurity', 'Google AI', 'chips', 'robotics',
];
let fallbackTopicIdx = 0;

async function fetchTrendingFallback(account) {
  const topic = FALLBACK_TOPICS[fallbackTopicIdx % FALLBACK_TOPICS.length];
  fallbackTopicIdx += 1;
  console.log(`[Trending] HN had no scrapable story — falling back to RSS news for "${topic}".`);
  return fetchNewsArticle(topic, [], account);
}

async function fetchTrendingArticle(account) {
  console.log('[Trending] Fetching HN front page top stories...');
  const history = await loadExclusions(account);

  const topItems = await fetchHNTopStories();

  // Score each item by AI/tech relevance + HN points
  const scored = topItems
    .filter((item) => {
      if (history.has(item.url)) return false;
      try {
        const host = new URL(item.url).hostname.replace('www.', '');
        return TRUSTED_DOMAINS.some((d) => host.includes(d));
      } catch { return false; }
    })
    .map((item) => {
      const text = item.title.toLowerCase();
      let score = item.hnPoints;
      for (const kw of TECH_AI_KEYWORDS) {
        if (text.includes(kw)) score += 20;
      }
      return { ...item, score };
    })
    .sort((a, b) => b.score - a.score);

  console.log(`[Trending] Top candidate: "${scored[0]?.title}" (score: ${scored[0]?.score})`);

  if (!scored.length) return fetchTrendingFallback(account);

  // Try to scrape top candidates
  for (const item of scored.slice(0, 8)) {
    try {
      const { text: fullText, ogImage } = await scrapeArticle(item.url);
      if (hasRealContent(fullText)) {
        const lowerText = fullText.slice(0, 500).toLowerCase();
        if (OPINION_SIGNALS.some((s) => lowerText.includes(s))) continue;
        console.log(`[Trending] Using: "${item.title}" (${item.hnPoints} pts)`);
        return {
          title:    item.title,
          url:      item.url,
          source:   'HackerNews',
          pubDate:  item.pubDate,
          fullText,
          ogImage,
          points:   item.hnPoints,
        };
      }
    } catch {}
  }

  return fetchTrendingFallback(account);
}

// ── VISA / IMMIGRATION NEWS (Indian workers + students) ─────────────────────
//
// The tech pool cannot serve this: HN never carries visa news and neither do
// the tech RSS feeds. These are direct-link Indian outlets, each verified to
// carry visa stories and to scrape cleanly with an og:image.
//
// Google News search RSS was tried and rejected: its links never leave
// news.google.com (they serve a ~600KB JS shell), so the article behind them
// can never be scraped for text or image.
// Corners, not just outlets. Indian NRI desks carry the day-to-day, the
// international-education trade press carries what universities are seeing, and
// the Federal Register carries the rule itself — usually days before any of them
// write it up. A pool drawn from one kind of source inherits that source's blind
// spots, and this one inherited them badly: for weeks a single outlet was the
// only one whose pages could be read at all.
//
// `dedicated` marks a desk that covers only this beat. It never admits a story
// by itself; it corroborates the everyday wording that a general desk would use
// about something else entirely.
const VISA_FEEDS = [
  { name: 'ET NRI',        url: 'https://economictimes.indiatimes.com/nri/rssfeeds/7771250.cms', dedicated: true },
  { name: 'TOI NRI',       url: 'https://timesofindia.indiatimes.com/rssfeeds/7098551.cms', dedicated: true },
  { name: 'IE Education',  url: 'https://indianexpress.com/section/education/feed/', dedicated: true },
  { name: 'PIE News',      url: 'https://thepienews.com/feed/', dedicated: true },
  { name: 'HT World',      url: 'https://www.hindustantimes.com/feeds/rss/world-news/rssfeed.xml' },
  { name: 'TOI US',        url: 'https://timesofindia.indiatimes.com/rssfeeds/30359486.cms' },
  { name: 'LiveMint',      url: 'https://www.livemint.com/rss/news' },
  { name: 'Hindu National', url: 'https://www.thehindu.com/news/national/feeder/default.rss' },
];

// The rule itself, from the source that publishes it.
//
// Every fee change, comment period and final rule appears here first, and the
// API is public, keyless and returns clean JSON. Documents scrape to full text
// with an image, so they run through the same pipeline as any article.
const FR_API = 'https://www.federalregister.gov/api/v1/documents.json';

// One request per term rather than one OR query: the API's OR handling narrows
// the result set to almost nothing, and a query that quietly returns zero is
// indistinguishable from a beat with no news in it.
const FR_TERMS = [
  'H-1B', 'student visa', 'optional practical training',
  'employment authorization', 'nonimmigrant', 'green card',
];

async function fetchFederalRegister({ days = 21, perTerm = 10 } = {}) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const batches = await Promise.all(FR_TERMS.map(async (term) => {
    try {
      const res = await axios.get(FR_API, {
        timeout: 12000,
        headers: HEADERS,
        params: {
          'conditions[term]': term,
          'conditions[publication_date][gte]': since,
          order: 'newest',
          per_page: perTerm,
          'fields[]': ['title', 'abstract', 'html_url', 'publication_date', 'type'],
        },
      });
      return res.data?.results || [];
    } catch (e) {
      // One source among several. A rule nobody fetched is a thinner pool, not
      // a failed run.
      console.log(`[Visa] Federal Register "${term}" unavailable: ${e.message}`);
      return [];
    }
  }));

  const byUrl = new Map();
  for (const doc of batches.flat()) {
    if (doc?.html_url && !byUrl.has(doc.html_url)) byUrl.set(doc.html_url, doc);
  }

  return [...byUrl.values()].map((doc) => ({
    title: String(doc.title || ''),
    url: doc.html_url,
    pubDate: doc.publication_date ? new Date(`${doc.publication_date}T12:00:00Z`).toUTCString() : '',
    summary: String(doc.abstract || '').slice(0, 300),
    source: `Federal Register (${doc.type || 'document'})`,
    dedicated: true,
    redditScore: 0,
    hnPoints: 0,
  })).filter((i) => i.url && i.title);
}

// Two desks at the same paper file the same story under different section URLs,
// so URL dedupe alone lets a story appear twice — and the second account in a
// slot then draws the near-duplicate its sibling just posted.
function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .slice(0, 8)
    .join(' ');
}

// The pool this account exists to serve — what qualifies, and how it ranks —
// lives in one place, because a keyword list spread through a scraper is a
// keyword list nobody maintains.
const {
  isIndianStudentStory,
  scoreIndianStudentStory,
} = require("./indianStudentTopics");

// Kept under the old names: the visa pool is what the rest of this file calls
// it, and the tests that guard the ranking were written against these.
const isIndianImmigrationStory = isIndianStudentStory;
const scoreVisaArticle = scoreIndianStudentStory;

// The ranked list is worth working through: the top few are the freshest, but
// an outlet that happens to be slow or paywalled today should not end the pool.
const VISA_SCRAPE_ATTEMPTS = Number(process.env.VISA_SCRAPE_ATTEMPTS || 20);

async function fetchVisaArticle(account) {
  console.log('[Visa] Fetching immigration news for Indian workers and students...');
  const [feedResults, federalRegister] = await Promise.all([
    Promise.all(VISA_FEEDS.map(async (feed) => {
      const items = await fetchRSSFeed(feed);
      // The prior belongs to the feed, and is carried on the item so the gate
      // can use it without knowing where the item came from.
      return items.map((item) => ({ ...item, dedicated: Boolean(feed.dedicated) }));
    })),
    fetchFederalRegister(),
  ]);
  const allItems = [...feedResults.flat(), ...federalRegister];
  console.log(`[Visa] Total raw articles: ${allItems.length} (${federalRegister.length} from the Federal Register)`);

  const history = await loadExclusions(account);
  const seen = new Set();
  const seenTitles = new Set();
  const THIS_YEAR = new Date().getFullYear();

  const candidates = allItems
    .filter((item) => {
      if (!item.url || seen.has(item.url) || history.has(item.url)) return false;
      const key = titleKey(item.title);
      if (key && seenTitles.has(key)) return false;
      if (!isIndianImmigrationStory(item, { sourceIsDedicated: item.dedicated })) return false;
      try {
        const host = new URL(item.url).hostname.replace('www.', '');
        if (BLOCKED_DOMAINS.some((d) => host.includes(d))) return false;
        if (!TRUSTED_DOMAINS.some((d) => host.includes(d))) return false;
      } catch { return false; }
      if (!item.pubDate) return false;
      const parsed = new Date(item.pubDate);
      if (isNaN(parsed.getTime()) || parsed.getFullYear() < THIS_YEAR) return false;
      seen.add(item.url);
      if (key) seenTitles.add(key);
      return true;
    })
    .map((item) => ({ ...item, score: scoreVisaArticle(item) }))
    .sort((a, b) => b.score - a.score);

  console.log(`[Visa] ${candidates.length} visa candidates after filtering`);
  if (!candidates.length) throw new Error('No fresh visa news found.');

  for (const item of candidates.slice(0, VISA_SCRAPE_ATTEMPTS)) {
    console.log(`[Visa] Trying: "${item.title}" (score:${item.score}) @ ${item.source}`);
    try {
      const { text: fullText, ogImage } = await scrapeArticle(item.url);
      if (!hasRealContent(fullText)) {
        // Silence here is how the pool looked empty while carrying twenty
        // stories: every candidate was being dropped for thin content with
        // nothing written down, and the slot fell through to tech news.
        console.log(`[Visa] Too thin (${stripBoilerplate(fullText).length} chars) — skipping ${item.source}`);
      }
      if (hasRealContent(fullText)) {
        console.log(`[Visa] Got "${item.title}" — ${fullText.length} chars, image: ${ogImage ? 'yes' : 'no'}`);
        // category drives the hashtag pool: tech tags on a visa post read as spam.
        return {
          title: item.title, url: item.url, source: item.source, pubDate: item.pubDate,
          fullText, ogImage, points: item.score, category: 'visa',
        };
      }
    } catch (e) {
      console.log(`[Visa] Scrape failed ${item.source}: ${e.message}`);
    }
  }

  throw new Error('Visa candidates found but none could be scraped.');
}

// ── TRUMP / MAJOR US POLITICS ───────────────────────────────────────────────
//
// Verified sources only. Axios carries by far the most Trump stories but
// returns 403 on its article pages, so nothing there is scrapable; Politico's
// feed is dead (403). Both were dropped rather than left to fail silently.
const TRUMP_FEEDS = [
  { name: 'Guardian US',   url: 'https://www.theguardian.com/us-news/rss' },
  { name: 'CNBC Politics', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000113' },
  { name: 'The Hill',      url: 'https://thehill.com/news/feed/' },
  { name: 'BBC US',        url: 'https://feeds.bbci.co.uk/news/world/us_and_canada/rss.xml' },
  { name: 'BBC World',     url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name: 'NPR Politics',  url: 'https://feeds.npr.org/1014/rss.xml' },
];

const TRUMP_GATE = /\btrump\b/i;

// "Big news", not any mention. Trump appears in dozens of stories a day, most
// of them incremental, so weight the things that make a story consequential.
const TRUMP_SIGNIFICANCE = [
  ['executive order', 30], ['supreme court', 28], ['indict', 30], ['impeach', 30],
  ['sanctions', 25], ['tariff', 25], ['pardon', 25], ['shutdown', 22], ['veto', 22],
  ['ruling', 22], ['ruled', 22], ['war', 22], ['strike', 20], ['fires', 20],
  ['fired', 20], ['resign', 20], ['investigation', 18], ['lawsuit', 16],
  ['summit', 18], ['ban', 18], ['signs', 15], ['signed', 15], ['deal', 15],
  ['billion', 15], ['election', 15], ['nominat', 15], ['announce', 12],
];

function scoreTrumpArticle(item) {
  const title = String(item.title || '').toLowerCase();
  const hay = `${title} ${String(item.summary || '').toLowerCase()}`;
  let score = 0;
  for (const [term, weight] of TRUMP_SIGNIFICANCE) {
    if (hay.includes(term)) score += weight;
  }
  // A story with Trump in the headline is about him; one that only mentions him
  // in the body usually is not.
  if (TRUMP_GATE.test(title)) score += 25;
  const ageHours = (Date.now() - new Date(item.pubDate).getTime()) / 3600000;
  if (Number.isFinite(ageHours)) score += Math.max(0, 40 - ageHours);
  return Math.round(score);
}

async function fetchTrumpArticle(account) {
  console.log('[Trump] Fetching major US politics news...');
  const results = await Promise.all(TRUMP_FEEDS.map(fetchRSSFeed));
  const allItems = results.flat();
  console.log(`[Trump] Total raw articles: ${allItems.length}`);

  const history = await loadExclusions(account);
  const seen = new Set();
  const THIS_YEAR = new Date().getFullYear();

  const candidates = allItems
    .filter((item) => {
      if (!item.url || seen.has(item.url) || history.has(item.url)) return false;
      const hay = `${item.title} ${item.summary}`;
      if (!TRUMP_GATE.test(hay)) return false;
      // Visa stories belong to the visa pool — posting them here would double up.
      if (isIndianImmigrationStory(item)) return false;
      try {
        const host = new URL(item.url).hostname.replace('www.', '');
        if (BLOCKED_DOMAINS.some((d) => host.includes(d))) return false;
        if (!TRUSTED_DOMAINS.some((d) => host.includes(d))) return false;
      } catch { return false; }
      if (!item.pubDate) return false;
      const parsed = new Date(item.pubDate);
      if (isNaN(parsed.getTime()) || parsed.getFullYear() < THIS_YEAR) return false;
      seen.add(item.url);
      return true;
    })
    .map((item) => ({ ...item, score: scoreTrumpArticle(item) }))
    .sort((a, b) => b.score - a.score);

  console.log(`[Trump] ${candidates.length} candidates after filtering`);
  if (!candidates.length) throw new Error('No fresh Trump news found.');

  for (const item of candidates.slice(0, 10)) {
    console.log(`[Trump] Trying: "${item.title}" (score:${item.score}) @ ${item.source}`);
    try {
      const { text: fullText, ogImage } = await scrapeArticle(item.url);
      if (hasRealContent(fullText)) {
        console.log(`[Trump] Got "${item.title}" — ${fullText.length} chars`);
        return {
          title: item.title, url: item.url, source: item.source, pubDate: item.pubDate,
          fullText, ogImage, points: item.score, category: 'politics',
        };
      }
    } catch (e) {
      console.log(`[Trump] Scrape failed ${item.source}: ${e.message}`);
    }
  }

  throw new Error('Trump candidates found but none could be scraped.');
}


module.exports = { loadHistory, postedSince, extractArticleText, isIndianImmigrationStory, scrapeArticle, jsonLdArticleBody, cooldownHours, __rememberUnrecorded: rememberUnrecorded, __clearUnrecorded: () => unrecorded.clear(), loadCrossAccountRecent, loadExclusions, fetchNewsArticle, fetchTrendingArticle, fetchVisaArticle, fetchTrumpArticle, scoreVisaArticle, scoreTrumpArticle, hasRealContent, stripBoilerplate, markPosted };
