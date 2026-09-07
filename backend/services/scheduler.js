const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const { fetchNewsArticle, fetchTrendingArticle, fetchVisaArticle, fetchTrumpArticle, markPosted, postedSince } = require('./newsScraper');
const { generateCarouselSlides } = require('./gemini');
const { composeSlideImages } = require('./imageComposer');
const { postCarousel } = require('./instagram');
const { getAccount, listActiveAccounts } = require('./accounts');
const { isDueWithin, searchReachability, parseCron, latestFiring, maxFiringGapMinutes } = require('./cronMatch');

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
 * The pools this account publishes, in slot order.
 *
 * Also the answer to "may this account post tech news at all", which is why it
 * is separate from pickSource: the empty-pool fallback has to ask that question
 * without asking which pool today's slot happens to land on.
 */
function effectivePlan(account = null) {
  // The account's own plan wins. Two accounts sharing one global SLOT_PLAN would
  // draw from the same pool in the same slot, which is how two handles end up
  // posting the same story on the same schedule.
  const own = Array.isArray(account?.slotPlan)
    ? account.slotPlan.filter((s) => SOURCES.includes(s))
    : [];
  return own.length ? own : slotPlan();
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
  const plan = effectivePlan(account);
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
async function runPipeline({ force = false, account: given, slot = null, slotStart = null, trigger = 'unknown' } = {}) {
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

  // The guard above lives in memory, and on a free tier that sleeps between
  // triggers the process almost never survives from one firing to the next — so
  // it is empty exactly when a second trigger for the same slot arrives. The
  // posting history is the only record that outlives a restart.
  if (!force && slotStart) {
    if (await postedSince(account, slotStart)) {
      console.log(`[Pipeline] Skipped ${slug} — already posted in the slot starting ${new Date(slotStart).toISOString()}`);
      return { success: false, skipped: true, reason: 'already-posted-this-slot', account: slug };
    }
  }

  lastStartedAt.set(slug, Date.now());
  inFlight.add(slug);
  jobStatus.lastRun = new Date().toISOString();

  try {
    const source = pickSource(new Date(), account);
    console.log(`[Pipeline] Source for this run: ${source} (as ${account.handle}, trigger: ${trigger}${slot ? `, slot ${slot}` : ''})`);

    // A themed pool that comes up empty — the feeds occasionally have nothing
    // new that clears the dedupe — falls back to tech, but only for an account
    // that publishes tech anyway. See techIsOnPlan below.
    const FETCHERS = { visa: fetchVisaArticle, trump: fetchTrumpArticle };
    // Whether the tech pool is a legitimate substitute for this account at all.
    // "A missed post is worse than an off-topic one" only holds for an account
    // that publishes tech anyway; for a single-subject handle the off-topic post
    // is the worse outcome, and it is permanent — an Instagram post cannot be
    // edited after publishing. So the fallback is offered to accounts whose own
    // plan already includes tech, and to nobody else.
    const techIsOnPlan = effectivePlan(account).includes('tech');
    let article;
    // A slot that could not get the topic it planned still posts, but it says so.
    // This fallback ran for weeks in silence while a themed account published
    // nothing but tech news, and a console line nobody reads was the only trace.
    let offPlan = null;
    if (FETCHERS[source]) {
      try {
        article = await FETCHERS[source](account);
      } catch (err) {
        if (!techIsOnPlan) {
          // Fails the slot deliberately. The account publishes one subject, so
          // there is nothing to substitute; the run goes red and the handle
          // stays on topic rather than quietly going off it.
          throw new Error(
            `${source} pool empty for ${slug} (${err.message}) — and its plan ` +
            `(${effectivePlan(account).join(', ')}) has no tech pool to fall back to, ` +
            'so this slot is skipped rather than posting off-topic news.',
          );
        }
        offPlan = { planned: source, reason: err.message };
        console.warn(`[Pipeline] ⚠ ${source} pool empty (${err.message}) — falling back to tech OFF PLAN.`);
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
        `Content rejected — context slide is ${words} words, needs 70-95. ` +
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
      plannedSource: source,
      actualSource: article.category || (offPlan ? 'tech' : source),
      offPlan: Boolean(offPlan),
      offPlanReason: offPlan ? offPlan.reason : null,
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

// Three minutes between accounts. They were never meant to publish together —
// Groq's free tier allows 8000 tokens a minute and one generation costs about
// 4000, so accounts firing at once rate-limit each other into the backoff path
// for no gain. A few minutes apart on the grid costs nothing and gives each run
// the whole budget, the image host and the Graph API to itself.
const ACCOUNT_STAGGER_MS = boundedEnv('ACCOUNT_STAGGER_MS', 3 * 60 * 1000, 0, 10 * 60 * 1000);
// How late a trigger may arrive and still count for the slot it was aimed at.
// Matches the double-fire guard window.
const DUE_WINDOW_MINUTES = boundedEnv('DUE_WINDOW_MINUTES', 30, 0, 180);
/**
 * How far back a schedule may have come due and still be worth posting.
 *
 * This is the catch-up horizon, not a tolerance for lateness — lateness is
 * handled by asking whether the account has posted since it came due. It bounds
 * two other things: a newly activated account does not immediately fire for a
 * slot that passed hours ago, and a schedule too rare to have come up recently
 * stays idle rather than retrying on every trigger until it succeeds.
 */
const CATCHUP_MINUTES = boundedEnv('CATCHUP_MINUTES', 24 * 60, 30, 48 * 60);
/**
 * When fan-out is actually invoked. An account whose schedule never lines up
 * with this can never run, however valid its own cron is.
 *
 * Read from the workflow that does the invoking, so there is one source of
 * truth rather than two that drift. TRIGGER_CRON overrides it for deployments
 * driven by something else, and a mismatch between the two is reported rather
 * than silently believed — an override that no longer matches the workflow
 * produces confident, wrong reachability verdicts.
 */
const MANIFEST_PATH = path.join(__dirname, '..', 'trigger-schedule.json');

function schedulesFromManifest() {
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    return (parsed.schedules || []).filter((c) => parseCron(c));
  } catch {
    return [];
  }
}

function resolveTriggerCron() {
  // render.yaml sets rootDir: backend, so .github is not deployed and the
  // workflow cannot be read at runtime. The manifest is generated from it by
  // scripts/sync-trigger-schedule.js and checked in CI, so it ships inside the
  // deployed directory and a workflow change also redeploys the backend.
  const fromManifest = schedulesFromManifest();
  const override = process.env.TRIGGER_CRON;

  if (!override) {
    if (fromManifest.length) return fromManifest;
    console.warn(
      '[Scheduler] no readable trigger-schedule.json — assuming 0 */6 * * *. ' +
      'Run: node scripts/sync-trigger-schedule.js',
    );
    return ['0 */6 * * *'];
  }

  const list = override.split(';').map((c) => c.trim()).filter(Boolean);
  const valid = list.filter((c) => parseCron(c));
  if (valid.length !== list.length) {
    throw new Error(
      `Refusing to start: TRIGGER_CRON="${override}" is not a valid schedule. ` +
      'Reachability is judged against it, so an unreadable value would produce ' +
      'confident wrong verdicts about which accounts can ever post.',
    );
  }

  const agrees = !fromManifest.length
    || JSON.stringify(valid) === JSON.stringify(fromManifest);
  if (agrees) return valid;

  // A disagreement is either a real external trigger or a stale override, and
  // the two are indistinguishable from here. Warning and believing it lets a
  // stale value quietly declare healthy accounts unreachable, so it has to be
  // stated deliberately.
  if (process.env.TRIGGER_SOURCE !== 'external') {
    throw new Error(
      `Refusing to start: TRIGGER_CRON (${valid.join(', ')}) disagrees with the ` +
      `workflow schedule (${fromManifest.join(', ')}). If something other than the ` +
      'workflow really drives this deployment, set TRIGGER_SOURCE=external to say so. ' +
      'Otherwise fix TRIGGER_CRON or re-run scripts/sync-trigger-schedule.js.',
    );
  }
  console.warn(
    `[Scheduler] TRIGGER_SOURCE=external — reachability follows TRIGGER_CRON ` +
    `(${valid.join(', ')}), not the workflow (${fromManifest.join(', ')}).`,
  );
  return valid;
}

const TRIGGER_CRON = resolveTriggerCron();
// The longest wait between two firings of that trigger — the span a single run
// is responsible for covering.
const TRIGGER_GAP_MINUTES = maxFiringGapMinutes(TRIGGER_CRON);
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

  // When did this account last come due, and has it posted since?
  //
  // The old question was "is this account due right now", inside a 30-minute
  // window. It answered no on every scheduled run for weeks: GitHub delivers a
  // trigger between half an hour and nearly five hours after the minute it
  // names, so the moment an account was due is always long past by the time
  // anything asks. Four green runs a day, nothing posted.
  //
  // Widening the window to "since the slot this trigger was sent for" fixes the
  // late trigger but not an account due *between* slots — a 09:00 account on a
  // six-hourly trigger is due at a moment no slot window contains, unless a
  // trigger happens to run hours late.
  //
  // So dueness is asked per account and against its own history: when did its
  // schedule last come up, and has it published since. That is true regardless
  // of when the trigger arrives, needs no watermark that a sleeping instance
  // would lose, and makes a second trigger for the same slot a no-op rather
  // than a second post.
  const slotStart = latestFiring(TRIGGER_CRON, now);
  if (slotStart) {
    const late = Math.round((now.getTime() - slotStart.getTime()) / 60000);
    console.log(`[Fan-out] Trigger sent for the ${slotStart.toISOString()} slot, arrived ${late}m later.`);
  }

  // A manual run ignores the schedule, which is the point of a manual run.
  const notDue = [];
  const alreadyPosted = [];
  const dueSince = new Map();
  const accounts = [];

  for (const a of active) {
    if (force) { accounts.push(a); continue; }

    // Bounded so a schedule that came up days ago does not fire the moment an
    // account is switched on, and so a rare schedule stays idle rather than
    // retrying forever.
    const cameDue = latestFiring(a.cron, now, {
      timeZone: a.timezone,
      maxLookbackMinutes: CATCHUP_MINUTES,
    });
    if (!cameDue) { notDue.push(a.slug); continue; }

    // Kept apart from notDue on purpose. "Its schedule has not come up" and
    // "it already covered this one" are the same silence from outside and
    // completely different situations: only the first can mean a broken cron.
    if (await postedSince(a, cameDue)) { alreadyPosted.push(a.slug); continue; }

    dueSince.set(a.slug, cameDue);
    accounts.push(a);
  }

  // Once accounts carry their own schedules, "nothing due" is ordinary: a daily
  // account is legitimately idle at three of the four slots. What is NOT
  // ordinary is a schedule that can never coincide with the trigger at all —
  // that account looks configured and silently never posts, which is the thing
  // worth failing over.
  // Only a completed search counts. An exhausted budget means "not found in the
  // time available", which is not evidence that the account is broken, and
  // reporting it as such would fail slots over a schedule that is fine.
  const unreachable = notDue.filter((slug) => {
    const a = active.find((x) => x.slug === slug);
    const { reachable, exhaustive } = searchReachability(a.cron, {
      timeZone: a.timezone,
      triggerCron: TRIGGER_CRON,
      // Judged over the whole gap between consecutive triggers, matching how
      // dueness is now decided. Asking over the old 30-minute window would call
      // a perfectly reachable 09:00 account unreachable on a 6-hourly trigger.
      windowMinutes: CATCHUP_MINUTES,
      now,
    });
    return !reachable && exhaustive;
  });

  if (notDue.length) {
    console.log(`[Fan-out] Not due this slot: ${notDue.join(', ')}`);
  }
  if (unreachable.length) {
    console.error(
      `[Fan-out] ✗ Never reachable with trigger "${TRIGGER_CRON.join(", ")}": ${unreachable.join(', ')}. ` +
      'These accounts will never post until their cron or the trigger schedule changes.',
    );
  }

  if (!accounts.length) {
    // No active accounts at all is a broken deployment. Nothing due this slot,
    // with every account reachable, is a normal quiet slot.
    const why = !active.length
      ? 'no active accounts are configured'
      : unreachable.length
        ? `${unreachable.length} account(s) can never be reached by trigger "${TRIGGER_CRON.join(", ")}"`
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
      alreadyPosted,
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
      results.push(await runPipeline({ account, slot, slotStart: dueSince.get(account.slug) || null, trigger, force }));
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
    // A themed account that posts tech news every slot looks healthy from every
    // other number here. This is the one that shows it.
    offPlan: results.filter((r) => r.offPlan).length,
    unreachable,
    results,
  };

  jobStatus.lastFanOut = {
    ...jobStatus.lastFanOut,
    finishedAt: new Date().toISOString(),
    activeAccounts: active.length,
    dueAccounts: accounts.length,
    notDue,
    alreadyPosted,
    unreachable,
    // Reported whether or not anything else posted. An unreachable account is a
    // handle that will never publish again; another account succeeding in the
    // same slot says nothing about it and must not mask it.
    error: unreachable.length
      ? `${unreachable.length} account(s) can never be reached by trigger "${TRIGGER_CRON.join(', ')}": ${unreachable.join(', ')}`
      : null,
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
  // The caller sees the same verdict as the status endpoint. They used to
  // differ — the returned summary carried no error at all once anything posted —
  // and two reports of one slot that disagree is how a broken handle stays
  // hidden behind a working one.
  return { ...summary, error: jobStatus.lastFanOut.error, alreadyPosted, notDue };
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

module.exports = { runPipeline, runAllAccounts, getTriggerCron: () => [...TRIGGER_CRON], startScheduler, stopScheduler, getStatus, setLastResult, autoResume, pickSource, slotPlan, effectivePlan };
