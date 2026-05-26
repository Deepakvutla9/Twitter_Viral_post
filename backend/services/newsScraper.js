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
  if (!db) {
    console.log('[Supabase] Not configured — skipping markPosted. Check SUPABASE_URL and SUPABASE_ANON_KEY env vars.');
    return;
  }
  try {
    console.log(`[Supabase] Saving URL: ${url}`);
    const { error } = await db.from('posted_urls').upsert({ url, posted_at: new Date().toISOString() });
    if (error) {
      console.error('[Supabase] upsert error:', error.message);
    } else {
      console.log('[Supabase] URL saved successfully.');
    }
    const { data } = await db.from('posted_urls').select('id').order('posted_at', { ascending: true });
    if (data && data.length > 100) {
      const idsToDelete = data.slice(0, data.length - 100).map((r) => r.id);
      await db.from('posted_urls').delete().in('id', idsToDelete);
    }
  } catch (e) {
    console.error('[Supabase] markPosted exception:', e.message);
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
  'apnews.com', 'politico.com', 'thehill.com', 'marketwatch.com',
  'nvidia.com', 'openai.com', 'anthropic.com', 'deepmind.com', 'google.com',
  'microsoft.com', 'meta.com', 'apple.com', 'amazon.com',
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
  { name: 'Wired AI',          url: 'https://www.wired.com/feed/category/artificial-intelligence/latest/rss' },
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

// ── ARTICLE SCRAPER ──────────────────────────────────────────────────────────
async function scrapeArticle(url) {
  const res = await axios.get(url, { timeout: 10000, headers: HEADERS });
  const $ = cheerio.load(res.data);

  // Grab og:image before removing elements
  const ogImage = $('meta[property="og:image"]').attr('content')
    || $('meta[name="twitter:image"]').attr('content')
    || null;

  $('script, style, nav, header, footer, aside, .ad, .advertisement, .related, .comments, .sidebar, .menu').remove();

  const selectors = [
    'article p', '[data-testid="article-body"] p', '.article-body p',
    '.article-content p', '.story-body p', '.post-content p',
    '.entry-content p', '.content p', 'main p', '[role="main"] p',
  ];

  for (const sel of selectors) {
    const paragraphs = $(sel).map((_, el) => $(el).text().trim()).get().filter((t) => t.length > 50);
    if (paragraphs.length >= 3) return { text: paragraphs.slice(0, 12).join('\n\n'), ogImage };
  }

  const all = $('p').map((_, el) => $(el).text().trim()).get().filter((t) => t.length > 60);
  return { text: all.slice(0, 10).join('\n\n'), ogImage };
}

// ── MAIN EXPORT ──────────────────────────────────────────────────────────────
async function fetchNewsArticle(topic, exclude = []) {
  console.log(`[News] Fetching viral news — topic: "${topic}"`);

  // Topic-specific tag feeds (TechCrunch + VentureBeat support tag RSS)
  const slug = topic.toLowerCase().trim().replace(/\s+/g, '-');
  const topicFeeds = [
    { name: `TechCrunch:${topic}`,  url: `https://techcrunch.com/tag/${slug}/feed/` },
    { name: `VentureBeat:${topic}`, url: `https://venturebeat.com/tag/${slug}/feed/` },
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
  const history    = await loadHistory();
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
      if (fullText.length > 200) {
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

  // Fallback
  const fallback = candidates[0];
  return {
    title:    fallback.title,
    url:      fallback.url,
    source:   fallback.source,
    pubDate:  fallback.pubDate,
    fullText: fallback.title + (fallback.summary ? '\n\n' + fallback.summary : ''),
    ogImage:  null,
    points:   fallback.score,
  };
}

// ── TRENDING: pick best AI/tech story from HN front page ─────────────────────
const TECH_AI_KEYWORDS = [
  'ai', 'openai', 'anthropic', 'google', 'meta', 'microsoft', 'nvidia',
  'llm', 'gpt', 'claude', 'gemini', 'model', 'robot', 'automation',
  'layoff', 'fired', 'hired', 'funding', 'startup', 'raises', 'billion',
  'apple', 'amazon', 'tesla', 'tech', 'software', 'developer', 'engineer',
  'machine learning', 'deep learning', 'data', 'chip', 'gpu', 'compute',
];

async function fetchTrendingArticle() {
  console.log('[Trending] Fetching HN front page top stories...');
  const history = await loadHistory();

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

  if (!scored.length) throw new Error('No trending tech stories found on HN');

  // Try to scrape top candidates
  for (const item of scored.slice(0, 8)) {
    try {
      const { text: fullText, ogImage } = await scrapeArticle(item.url);
      if (fullText.length > 200) {
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

  throw new Error('Could not scrape any trending HN story');
}

module.exports = { fetchNewsArticle, fetchTrendingArticle, markPosted };
