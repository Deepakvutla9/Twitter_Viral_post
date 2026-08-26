const cron = require('node-cron');
const { fetchNewsArticle, fetchTrendingArticle, fetchVisaArticle, fetchTrumpArticle, markPosted } = require('./newsScraper');
const { generateCarouselSlides } = require('./gemini');
const { composeSlideImages } = require('./imageComposer');
const { postCarousel } = require('./instagram');
const { getAccount, listActiveAccounts } = require('./accounts');
const { isDueWithin, isReachable } = require('./cronMatch');

let activeJob = null;

// Set REQUIRE_QUALITY=false to publish regardless of the score.
const REQUIRE_QUALITY = process.env.REQUIRE_QUALITY !== 'false';

const SOURCES = ['tech', 'visa', 'trump'];
// Which pool each of the four daily slots (00/06/12/18 UTC) draws from.
// Visa gets two slots because it is the primary brief; tech and Trump get one
// each. Override with SLOT_PLAN, e.g. SLOT_PLAN=trump,visa,trump,tech
const DEFAULT_SLOT_PLAN = ['tech', 'visa', 'trump', 'visa'];
function slotPlan() {
  const raw = process.env.SLOT_PLAN;
  if (!raw) return DEFAULT_SLOT_PLAN;
  const parsed = raw.split(',').map((s) => s.trim().toLowerCase()).filter((s) => SOURCES.includes(s));
  if (!parsed.length) {
    console.warn(`[Scheduler] ignoring invalid SLOT_PLAN: ${raw}`);
    return DEFAULT_SLOT_PLAN;
  }
  return parsed;
}
/**
 * Chooses which pool this run draws from, so one account can carry tech, visa
 * and Trump news without any of them crowding the others out.
 *
 * Derived from the clock rather than a rotating counter on purpose: the
 * free-tier instance sleeps and restarts constantly, so an in-memory index
 * would reset to the same value every run and only ever pick one source.
 * Keying off the 6-hour block also means a late-firing cron or a manual run
 * inside the same window picks the same source instead of flipping.
 *
 * CONTENT_SOURCE=tech|visa|trump pins it for manual runs.
 */
function pickSource(now = new Date(), account = null) {
  const forced = process.env.CONTENT_SOURCE;
  if (SOURCES.includes(forced)) return forced;
  // The account's own plan wins. Two accounts sharing one global SLOT_PLAN would
  // draw from the same pool in the same slot, which is how two handles end up
  // posting the same story on the same schedule.
  const own = Array.isArray(account?.slotPlan)
    ? account.slotPlan.filter((s) => SOURCES.includes(s))
    : [];
  const plan = own.length ? own : slotPlan();
  return plan[Math.floor(now.getUTCHours() / 6) % plan.length];
}

// The external GitHub Actions trigger and the in-process cron both aim at the
// same 09:00/18:00 slots. If the instance happens to be awake when the cron
// fires, both would run and we'd double-post. This guard keeps only the first
// one in any 30-minute window; manual runs from the UI pass force:true.
const MIN_GAP_MS = 30 * 60 * 1000;
// Keyed by account slug — see runPipeline.
const lastStartedAt = new Map();
const inFlight = new Set();

let jobStatus = {
  running: false,
  schedule: null,
  lastRun: null,
  lastResult: null,
  nextTopic: 'HN Trending',
  totalPosted: 0,
  // Set by runAllAccounts. lastResult describes one account; this describes the
  // whole slot, which is what an external caller has to wait for.
  lastFanOut: null,
};

/**
 * One run, for one account.
 *
 * The guards are keyed by account slug rather than held as single values. They
 * exist to stop the external trigger and the in-process cron double-posting the
 * same account, which is a per-account question — one account being mid-run is
 * no reason to skip another. A shared guard would silently serialise the fan-out
 * in runAllAccounts into posting one account per slot.
 */
async function runPipeline({ force = false, account: given, slot = null, trigger = 'unknown' } = {}) {
  // Resolved before the guards, since which account this is decides which guard
  // applies. A broken account also fails here, before any scraping or model call.
  const account = given || await getAccount();
  const slug = account.slug;

  if (inFlight.has(slug)) {
    console.log(`[Pipeline] Skipped ${slug} — a run is already in flight`);
    return { success: false, skipped: true, reason: 'in-flight', account: slug };
  }
  const startedAt = lastStartedAt.get(slug) || 0;
  if (!force && Date.now() - startedAt < MIN_GAP_MS) {
    const mins = Math.round((Date.now() - startedAt) / 60000);
    console.log(`[Pipeline] Skipped ${slug} — last run started ${mins}m ago (double-fire guard)`);
    return { success: false, skipped: true, reason: 'debounced', account: slug };
  }

  lastStartedAt.set(slug, Date.now());
  inFlight.add(slug);
  jobStatus.lastRun = new Date().toISOString();

  try {
    const source = pickSource(new Date(), account);
    console.log(`[Pipeline] Source for this run: ${source} (as ${account.handle}, trigger: ${trigger}${slot ? `, slot ${slot}` : ''})`);

    // Visa news falls back to the tech pool rather than failing the slot — a
    // missed post is worse than an off-topic one, and the feeds occasionally
    // have nothing new that clears the dedupe.
    // A themed pool falls back to tech rather than failing the slot: a missed
    // post is worse than an off-topic one, and the feeds occasionally have
    // nothing new that clears the dedupe.
    const FETCHERS = { visa: fetchVisaArticle, trump: fetchTrumpArticle };
    let article;
    if (FETCHERS[source]) {
      try {
        article = await FETCHERS[source](account);
      } catch (err) {
        console.warn(`[Pipeline] ${source} pool empty (${err.message}) — falling back to tech.`);
        article = await fetchTrendingArticle(account);
      }
    } else {
      article = await fetchTrendingArticle(account);
    }
    console.log(`[Pipeline] Selected: "${article.title}" (${article.points} pts, ${article.category || 'tech'})`);

    const { slides, caption, imagePrompt, quality } = await generateCarouselSlides(article, article.title, account);
    const words = quality?.checks?.bodyWordCount ?? 0;
    console.log(`[Pipeline] Generated ${slides.length} slides — quality ${quality?.score ?? '?'}/100, ${words}-word context slide`);

    // The scoring existed but only the manual UI ever saw it, so autopilot
    // happily published one-sentence context slides that read as broken posts.
    // An Instagram post cannot be edited after publishing: failing this run is
    // recoverable, a thin carousel sitting on the grid is not.
    if (REQUIRE_QUALITY && !quality?.checks?.bodyLengthOk) {
      throw new Error(
        `Content too thin to publish — context slide is ${words} words, needs 70-115. ` +
        (quality?.warnings || []).join(' '),
      );
    }

    // Pass imagePrompt so slide 2 gets an AI background (HF → Pollinations),
    // falling back to the darkened article photo — matches the generate route.
    const images = await composeSlideImages(slides, {
      ogImage: article.ogImage || null,
      imagePrompt: imagePrompt || null,
      account,
    });
    const imagePaths = images.map((i) => i.filepath);

    const postId = await postCarousel(imagePaths, caption, account);
    const recorded = await markPosted(article.url, account);
    jobStatus.totalPosted++;

    // The post is out. If recording it failed, the database cannot warn the next
    // account off this story, so the run reports it rather than swallowing it —
    // and newsScraper holds the URL in memory as a stopgap for the rest of this
    // process, which is what covers the very next account in the same fan-out.
    if (recorded && recorded.ok === false && !recorded.skipped) {
      console.error(
        `[Pipeline] ⚠ ${slug} published ${postId} but the URL was not recorded: ${recorded.error}. ` +
        'Another account could pick the same story once this process restarts.',
      );
    }

    const result = {
      success: true,
      postId,
      topic: article.title,
      article: article.title,
      postedAt: new Date().toISOString(),
      account: slug,
      recorded: !(recorded && recorded.ok === false && !recorded.skipped),
    };
    jobStatus.lastResult = result;

    console.log(`[Pipeline] Posted: ${postId} (total: ${jobStatus.totalPosted})`);
    return result;
  } finally {
    inFlight.delete(slug);
  }
}

// Runs are sequential with a gap between them, never parallel. Groq's free tier
// allows 8000 tokens per minute and one generation costs roughly 4000, so two
// accounts firing together would rate-limit each other into the backoff path for
// no gain. Sequential also keeps the image uploads and Graph API calls apart.
/**
 * A bounded number from the environment, or the default.
 *
 * Number('') is 0, Number('abc') is NaN and Number('Infinity') is Infinity —
 * and an infinite due window makes the matcher's loop non-terminating, while a
 * malformed stagger silently removes the spacing the Groq budget depends on.
 * Neither should be reachable by a typo.
 */
function boundedEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || n > max) {
    console.warn(`[Scheduler] ignoring invalid ${name}="${raw}" — using ${fallback} (allowed ${min}-${max})`);
    return fallback;
  }
  return n;
}

const ACCOUNT_STAGGER_MS = boundedEnv('ACCOUNT_STAGGER_MS', 60000, 0, 10 * 60 * 1000);
// How late a trigger may arrive and still count for the slot it was aimed at.
// Matches the double-fire guard window.
const DUE_WINDOW_MINUTES = boundedEnv('DUE_WINDOW_MINUTES', 30, 0, 180);
// When fan-out is actually invoked in production. An account whose schedule
// never lines up with this can never run, however valid its cron is.
const TRIGGER_CRON = process.env.TRIGGER_CRON || '0 */6 * * *';
let fanOutInFlight = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * One slot, every active account.
 *
 * An account that throws must not take the rest of the slot down with it: a
 * dead token on one handle is not a reason for the others to miss a post. Each
 * result is collected either way, so the caller can tell "posted", "skipped by
 * the guard" and "failed" apart instead of seeing one aggregate error.
 */
async function runAllAccounts({
  slot = null, trigger = 'fan-out', force = false,
  stagger = ACCOUNT_STAGGER_MS, now = new Date(),
} = {}) {
  // The in-process cron and the external trigger aim at the same slot, and the
  // per-account guards do not stop two fan-outs interleaving: one would run
  // account A while the other runs account B, which breaks the sequential
  // spacing the Groq budget depends on and leaves lastFanOut describing a mix
  // of both. Only one fan-out at a time.
  if (fanOutInFlight) {
    console.log('[Fan-out] Skipped — a fan-out is already running');
    return { skipped: true, reason: 'fan-out-in-flight', accounts: 0, posted: 0, failed: 0, results: [] };
  }
  fanOutInFlight = true;

  try {
    return await fanOut({ slot, trigger, force, stagger, now });
  } finally {
    fanOutInFlight = false;
  }
}

async function fanOut({ slot, trigger, force, stagger, now }) {
  const active = await listActiveAccounts();

  // An account only runs in the slots its own cron names, in its own timezone.
  // A manual run ignores the schedule, which is the point of a manual run.
  const notDue = [];
  const accounts = force ? active : active.filter((a) => {
    if (isDueWithin(a.cron, { timeZone: a.timezone, now, windowMinutes: DUE_WINDOW_MINUTES })) return true;
    notDue.push(a.slug);
    return false;
  });

  // Once accounts carry their own schedules, "nothing due" is ordinary: a daily
  // account is legitimately idle at three of the four slots. What is NOT
  // ordinary is a schedule that can never coincide with the trigger at all —
  // that account looks configured and silently never posts, which is the thing
  // worth failing over.
  const unreachable = notDue.filter((slug) => {
    const a = active.find((x) => x.slug === slug);
    return !isReachable(a.cron, {
      timeZone: a.timezone,
      triggerCron: TRIGGER_CRON,
      windowMinutes: DUE_WINDOW_MINUTES,
      now,
    });
  });

  if (notDue.length) {
    console.log(`[Fan-out] Not due this slot: ${notDue.join(', ')}`);
  }
  if (unreachable.length) {
    console.error(
      `[Fan-out] ✗ Never reachable with trigger "${TRIGGER_CRON}": ${unreachable.join(', ')}. ` +
      'These accounts will never post until their cron or the trigger schedule changes.',
    );
  }

  if (!accounts.length) {
    // No active accounts at all is a broken deployment. Nothing due this slot,
    // with every account reachable, is a normal quiet slot.
    const why = !active.length
      ? 'no active accounts are configured'
      : unreachable.length
        ? `no account is due and ${unreachable.length} can never be reached by trigger "${TRIGGER_CRON}"`
        : null;
    if (why) console.error(`[Fan-out] ✗ Nothing to run — ${why}`);
    else console.log(`[Fan-out] Nothing due this slot (${active.length} active, all reachable)`);

    jobStatus.lastFanOut = {
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      trigger,
      accounts: 0,
      activeAccounts: active.length,
      notDue,
      unreachable,
      posted: 0,
      skipped: 0,
      failed: 0,
      unrecorded: 0,
      error: why,
      results: [],
    };
    return { accounts: 0, posted: 0, skipped: 0, failed: 0, results: [], unreachable, error: why };
  }

  console.log(`[Fan-out] ${accounts.length} account(s) due, ${stagger}ms apart`);

  // Reported separately from lastResult, which only ever describes one account.
  // The external trigger polls this to know the whole slot is done: watching
  // lastResult, it would see the first account post and stop polling, and the
  // polling is what keeps a free-tier instance awake for the accounts still to
  // come. A sleeping instance finishes nothing.
  jobStatus.lastFanOut = {
    startedAt: new Date().toISOString(),
    finishedAt: null,
    trigger,
    accounts: accounts.length,
    results: [],
  };

  const results = [];
  for (let i = 0; i < accounts.length; i += 1) {
    const account = accounts[i];
    if (i > 0 && stagger > 0) await sleep(stagger);
    try {
      results.push(await runPipeline({ account, slot, trigger, force }));
    } catch (err) {
      console.error(`[Fan-out] ${account.slug} failed: ${err.message}`);
      results.push({ success: false, account: account.slug, error: err.message });
    }
  }

  const summary = {
    accounts: accounts.length,
    posted: results.filter((r) => r.success).length,
    skipped: results.filter((r) => r.skipped).length,
    failed: results.filter((r) => !r.success && !r.skipped).length,
    unrecorded: results.filter((r) => r.recorded === false).length,
    results,
  };

  jobStatus.lastFanOut = {
    ...jobStatus.lastFanOut,
    finishedAt: new Date().toISOString(),
    activeAccounts: accounts.length,
    notDue,
    unreachable,
    posted: summary.posted,
    skipped: summary.skipped,
    failed: summary.failed,
    unrecorded: summary.unrecorded,
    results: results.map((r) => ({
      account: r.account,
      outcome: r.success ? 'posted' : r.skipped ? 'skipped' : 'failed',
      reason: r.reason || r.error || null,
      postId: r.postId || null,
      recorded: r.recorded !== false,
    })),
  };

  console.log(`[Fan-out] ${summary.posted} posted, ${summary.skipped} skipped, ${summary.failed} failed, ${summary.unrecorded} unrecorded`);
  return summary;
}

function startScheduler(cronExpression) {
  if (activeJob) { activeJob.stop(); activeJob = null; }

  jobStatus.running  = true;
  jobStatus.schedule = cronExpression;

  activeJob = cron.schedule(cronExpression, async () => {
    try {
      await runAllAccounts({ trigger: 'cron' });
    } catch (err) {
      console.error('[Scheduler] Pipeline error:', err.message);
      jobStatus.lastResult = { success: false, error: err.message, failedAt: new Date().toISOString() };
    }
  });

  console.log(`[Scheduler] Started — schedule: ${cronExpression}`);
  return jobStatus;
}

function stopScheduler() {
  if (activeJob) { activeJob.stop(); activeJob = null; }
  jobStatus.running = false;
  return jobStatus;
}

function getStatus() {
  return jobStatus;
}

function setLastResult(result) {
  jobStatus.lastResult = result;
}

function autoResume() {
  const defaultCron = process.env.DEFAULT_CRON || '0 */6 * * *'; // every 6 hours by default
  console.log(`[Scheduler] Auto-resuming with schedule: ${defaultCron}`);
  startScheduler(defaultCron);
}

module.exports = { runPipeline, runAllAccounts, startScheduler, stopScheduler, getStatus, setLastResult, autoResume, pickSource, slotPlan };
