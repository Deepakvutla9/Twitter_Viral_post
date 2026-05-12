const axios = require('axios');
const xml2js = require('xml2js');
const cheerio = require('cheerio');
const { createClient } = require('@supabase/supabase-js');

let supabase = null;

function getSupabase() {
  if (!supabase && process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY) {
    supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
  }
  return supabase;
}

async function loadHistory() {
  const db = getSupabase();
  if (!db) return new Set();
  try {
    const { data } = await db.from('posted_urls').select('url');
    return new Set((data || []).map((r) => r.url));
  } catch { return new Set(); }
}

async function markPosted(url) {
  const db = getSupabase();
  if (!db) return;
  try {
    await db.from('posted_urls').upsert({ url, posted_at: new Date().toISOString() });
    const { data } = await db.from('posted_urls').select('id').order('posted_at', { ascending: true });
    if (data && data.length > 100) {
      const idsToDelete = data.slice(0, data.length - 100).map((r) => r.id);
      await db.from('posted_urls').delete().in('id', idsToDelete);
    }
  } catch {}
}

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
};

// Top tech/AI RSS feeds
const RSS_FEEDS = [
  { name: 'TechCrunch AI',     url: 'https://techcrunch.com/category/artificial-intelligence/feed/' },
  { name: 'VentureBeat AI',    url: 'https://venturebeat.com/category/ai/feed/' },
  { name: 'Ars Technica Tech', url: 'https://feeds.arstechnica.com/arstechnica/technology-lab' },
  { name: 'The Verge AI',      url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml' },
  { name: 'Wired',             url: 'https://www.wired.com/feed/category/artificial-intelligence/latest/rss' },
  { name: 'MIT Tech Review',   url: 'https://www.technologyreview.com/feed/' },
  { name: 'TechCrunch',        url: 'https://techcrunch.com/feed/' },
  { name: 'The Verge',         url: 'https://www.theverge.com/rss/index.xml' },
];

// Keywords to score relevance
const AI_KEYWORDS = [
  'openai', 'anthropic', 'claude', 'gpt', 'gemini', 'llm', 'chatgpt',
  'artificial intelligence', ' ai ', 'machine learning', 'deep learning',
  'neural network', 'layoff', 'fired', 'funding', 'billion', 'regulation',
  'model', 'robot', 'automation', 'agi', 'nvidia', 'google ai', 'meta ai',
  'microsoft ai', 'apple ai', 'amazon ai', 'startup', 'tech',
];

async function fetchRSSFeed(feed) {
  try {
    const res = await axios.get(feed.url, { timeout: 8000, headers: HEADERS });
    const parsed = await xml2js.parseStringPromise(res.data, { explicitArray: false });

    let items = [];

    // RSS 2.0
    if (parsed.rss?.channel?.item) {
      const raw = parsed.rss.channel.item;
      items = Array.isArray(raw) ? raw : [raw];
    }
    // Atom
    else if (parsed.feed?.entry) {
      const raw = parsed.feed.entry;
      items = (Array.isArray(raw) ? raw : [raw]).map((e) => ({
        title: typeof e.title === 'object' ? e.title._ : e.title,
        link: typeof e.link === 'object' ? (e.link.$ ?.href || e.link) : e.link,
        pubDate: e.published || e.updated,
        description: typeof e.summary === 'object' ? e.summary._ : (e.summary || ''),
      }));
    }

    return items.map((item) => ({
      title:   typeof item.title === 'object' ? item.title._ : (item.title || ''),
      url:     typeof item.link  === 'object' ? item.link._  : (item.link  || ''),
      pubDate: item.pubDate || item.published || '',
      summary: item.description || item.summary || '',
      source:  feed.name,
    })).filter((i) => i.url && i.title);

  } catch (e) {
    console.log(`[RSS] Failed ${feed.name}: ${e.message}`);
    return [];
  }
}

function scoreArticle(item, topic) {
  const text = (item.title + ' ' + item.summary).toLowerCase();
  const topicWords = topic.toLowerCase().split(' ');

  let score = 0;

  // Topic match — heavily weighted so topic articles always win
  for (const word of topicWords) {
    if (word.length > 2 && text.includes(word)) score += 30;
  }
  // Full topic phrase match bonus
  if (text.includes(topic.toLowerCase())) score += 50;

  // AI keyword relevance
  for (const kw of AI_KEYWORDS) {
    if (text.includes(kw)) score += 2;
  }

  // Freshness — prefer articles from last 7 days
  if (item.pubDate) {
    const age = Date.now() - new Date(item.pubDate).getTime();
    const days = age / (1000 * 60 * 60 * 24);
    if (days < 1) score += 20;
    else if (days < 3) score += 10;
    else if (days < 7) score += 5;
  }

  return score;
}

async function scrapeArticle(url) {
  const res = await axios.get(url, { timeout: 10000, headers: HEADERS });
  const $ = cheerio.load(res.data);

  $('script, style, nav, header, footer, aside, .ad, .advertisement, .related, .comments, .sidebar, .menu').remove();

  const selectors = [
    'article p',
    '[data-testid="article-body"] p',
    '.article-body p',
    '.article-content p',
    '.story-body p',
    '.post-content p',
    '.entry-content p',
    '.content p',
    'main p',
    '[role="main"] p',
  ];

  for (const sel of selectors) {
    const paragraphs = $(sel)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter((t) => t.length > 50);
    if (paragraphs.length >= 3) return paragraphs.slice(0, 12).join('\n\n');
  }

  const all = $('p').map((_, el) => $(el).text().trim()).get().filter((t) => t.length > 60);
  return all.slice(0, 10).join('\n\n');
}

function getTopicFeeds(topic) {
  const slug = topic.toLowerCase().trim().replace(/\s+/g, '-');
  return [
    { name: `TechCrunch:${topic}`,    url: `https://techcrunch.com/tag/${slug}/feed/` },
    { name: `VentureBeat:${topic}`,   url: `https://venturebeat.com/tag/${slug}/feed/` },
  ];
}

async function fetchNewsArticle(topic, exclude = []) {
  console.log(`[RSS] Fetching from feeds — topic: "${topic}"`);

  // Always include topic-specific tag feeds first for relevance
  const topicFeeds = getTopicFeeds(topic);
  const allFeeds = [...topicFeeds, ...RSS_FEEDS];

  // Fetch all feeds in parallel
  const results = await Promise.all(allFeeds.map(fetchRSSFeed));
  const allItems = results.flat();

  console.log(`[RSS] Total articles found: ${allItems.length}`);

  // Deduplicate, filter history and exclude list
  const history  = await loadHistory();
  const excludeSet = new Set(exclude);
  const seen     = new Set();

  const BLOCKED_DOMAINS = ['x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'tiktok.com', 'reddit.com'];

  const candidates = allItems
    .filter((item) => {
      if (!item.url || seen.has(item.url)) return false;
      if (history.has(item.url) || excludeSet.has(item.url)) return false;
      try {
        const host = new URL(item.url).hostname.replace('www.', '');
        if (BLOCKED_DOMAINS.some((d) => host.includes(d))) return false;
      } catch { return false; }
      seen.add(item.url);
      return true;
    })
    .map((item) => ({ ...item, score: scoreArticle(item, topic) }))
    .sort((a, b) => b.score - a.score);

  console.log(`[RSS] ${candidates.length} unique candidates after filtering`);

  if (!candidates.length) throw new Error('No fresh articles found. Try a different topic.');

  // Try top candidates until we get one with full article text
  for (const item of candidates.slice(0, 8)) {
    console.log(`[RSS] Trying: "${item.title}" (score: ${item.score}) @ ${item.source}`);
    try {
      const fullText = await scrapeArticle(item.url);
      if (fullText.length > 200) {
        console.log(`[RSS] Got "${item.title}" — ${fullText.length} chars`);
        return {
          title:    item.title,
          url:      item.url,
          source:   item.source,
          pubDate:  item.pubDate,
          fullText,
          points:   item.score,
        };
      }
    } catch (e) {
      console.log(`[RSS] Failed scrape ${item.source}: ${e.message}`);
    }
  }

  // Fallback: use summary from RSS if scrape fails
  const fallback = candidates[0];
  return {
    title:    fallback.title,
    url:      fallback.url,
    source:   fallback.source,
    pubDate:  fallback.pubDate,
    fullText: fallback.title + (fallback.summary ? '\n\n' + fallback.summary : ''),
    points:   fallback.score,
  };
}

module.exports = { fetchNewsArticle, markPosted };
