const axios = require('axios');
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
    // Keep only last 100
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

const AI_QUERIES = [
  'OpenAI',
  'Anthropic',
  'AI jobs',
  'AI layoffs',
  'Google AI',
  'Claude',
  'GPT',
  'AI model',
  'artificial intelligence',
  'AI regulation',
  'AI funding',
  'machine learning',
];

async function searchHN(query) {
  const since = Math.floor(Date.now() / 1000) - 180 * 24 * 60 * 60;
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&numericFilters=created_at_i>${since},points>20&hitsPerPage=8`;
  const res = await axios.get(url, { timeout: 8000 });
  return res.data.hits.filter((h) => h.url && !h.url.includes('ycombinator.com'));
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

async function fetchNewsArticle(topic, exclude = []) {
  console.log(`[Scraper] Searching for viral AI news (topic hint: "${topic}")`);

  const queries = [topic, ...AI_QUERIES].slice(0, 8);
  const results = await Promise.allSettled(queries.map(searchHN));

  const seen = new Set();
  const history = await loadHistory();
  const excludeSet = new Set(exclude);

  const allHits = results
    .flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((h) => {
      if (seen.has(h.url) || history.has(h.url) || excludeSet.has(h.url)) return false;
      seen.add(h.url);
      return true;
    })
    .sort((a, b) => (b.points || 0) - (a.points || 0));

  console.log(`[Scraper] Found ${allHits.length} candidate stories`);

  if (!allHits.length) throw new Error(`No news found for "${topic}"`);

  for (const hit of allHits.slice(0, 6)) {
    const title = hit.title;
    const url = hit.url;
    const source = new URL(url).hostname.replace('www.', '');
    const pubDate = hit.created_at;

    console.log(`[Scraper] Trying: "${title}" (${hit.points} pts) @ ${source}`);

    try {
      const fullText = await scrapeArticle(url);
      if (fullText.length > 200) {
        console.log(`[Scraper] Got "${title}" — ${fullText.length} chars`);
        // Don't mark posted here — only mark after actual Instagram post
        return { title, url, source, pubDate, fullText, points: hit.points };
      }
    } catch (e) {
      console.log(`[Scraper] Failed ${source}: ${e.message}`);
    }
  }

  const hit = allHits[0];
  return {
    title: hit.title,
    url: hit.url,
    source: new URL(hit.url).hostname.replace('www.', ''),
    pubDate: hit.created_at,
    fullText: hit.title + (hit.story_text ? '\n\n' + hit.story_text : ''),
    points: hit.points,
  };
}

module.exports = { fetchNewsArticle, markPosted };
