import { useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchNews,
  generateSlides,
  generateCustomSlides,
  postCarousel,
  runPipeline,
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  getTrending,
  getQueue,
  addToQueue,
  removeFromQueue,
} from './api';
import './FrontrunApp.css';

const CRON_PRESETS = [
  { label: 'Hourly', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Morning brief', value: '0 9 * * *' },
  { label: 'Morning + evening', value: '0 9,18 * * *' },
];

const IMG_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace('/api', '');

function signalHeat(item, index = 0) {
  const points = Number(item?.points || item?.score || 0);
  const comments = Number(item?.comments || item?.commentCount || 0);
  const base = Math.min(34, Math.round(points / 18)) + Math.min(22, Math.round(comments / 10));
  return Math.max(62, Math.min(98, 94 - index * 5 + base));
}

function sourceName(item) {
  return item?.source || item?.site || item?.by || 'Live source';
}

function shortText(value, max = 150) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function formatTime(value) {
  if (!value) return 'Queued';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Queued';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function FrontrunApp() {
  const [topic, setTopic] = useState('');
  const [article, setArticle] = useState(null);
  const [seenUrls, setSeenUrls] = useState([]);
  const [trending, setTrending] = useState([]);
  const [selectedSignal, setSelectedSignal] = useState(0);
  const [slides, setSlides] = useState([]);
  const [caption, setCaption] = useState('');
  const [quality, setQuality] = useState(null);
  const [imageUrls, setImageUrls] = useState([]);
  const [imagePaths, setImagePaths] = useState([]);
  const [postQueue, setPostQueue] = useState([]);
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [cronExpression, setCronExpression] = useState('0 9,18 * * *');
  const [scheduledAt, setScheduledAt] = useState('');
  const [customTitle, setCustomTitle] = useState('');
  const [customBody, setCustomBody] = useState('');
  const [customImage, setCustomImage] = useState(null);
  const [customPreview, setCustomPreview] = useState(null);
  const [mode, setMode] = useState('brief');
  const [error, setError] = useState(null);
  const [posted, setPosted] = useState(null);
  const [queueSuccess, setQueueSuccess] = useState(false);
  const [loading, setLoading] = useState({
    wire: false,
    brief: false,
    custom: false,
    launch: false,
    autopilot: false,
  });
  const [booting, setBooting] = useState(true);
  const fileInputRef = useRef(null);

  useEffect(() => {
    refreshSystems();
    const interval = setInterval(refreshSystems, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => setBooting(false), 1250);
    return () => clearTimeout(timeout);
  }, []);

  async function refreshSystems() {
    try {
      const [stories, queue, status] = await Promise.all([
        getTrending().catch(() => []),
        getQueue().catch(() => []),
        getSchedulerStatus().catch(() => null),
      ]);
      setTrending(Array.isArray(stories) ? stories : []);
      setPostQueue(Array.isArray(queue) ? queue : []);
      setSchedulerStatus(status);
    } catch {
      // The product should still open if one background service is offline.
    }
  }

  function setLoad(key, value) {
    setLoading((current) => ({ ...current, [key]: value }));
  }

  function resetDraft() {
    setSlides([]);
    setCaption('');
    setQuality(null);
    setImageUrls([]);
    setImagePaths([]);
    setPosted(null);
    setQueueSuccess(false);
  }

  async function pullSignal(refresh = false) {
    const query = topic.trim() || currentSignal?.title || 'AI startups';
    setError(null);
    resetDraft();
    setLoad('wire', true);
    try {
      const exclude = refresh && article ? [...seenUrls] : [];
      const nextArticle = await fetchNews(query, exclude);
      setArticle(nextArticle);
      setTopic(query);
      setSeenUrls((prev) => [...new Set([...prev, nextArticle.url])]);
      setMode('brief');
      return nextArticle;
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      return null;
    } finally {
      setLoad('wire', false);
    }
  }

  async function buildBrief() {
    setError(null);
    resetDraft();
    setLoad('brief', true);
    try {
      let sourceArticle = article;
      let sourceTopic = topic.trim();

      if (!sourceArticle) {
        sourceTopic = sourceTopic || currentSignal?.title || 'AI startups';
        sourceArticle = await fetchNews(sourceTopic, []);
        setArticle(sourceArticle);
        setTopic(sourceTopic);
        setSeenUrls((prev) => [...new Set([...prev, sourceArticle.url])]);
      }

      const result = await generateSlides(sourceArticle, sourceTopic || sourceArticle.title);
      setSlides(result.slides || []);
      setCaption(result.caption || '');
      setQuality(result.quality || null);
      setImageUrls(result.imageUrls || []);
      setImagePaths(result.imagePaths || []);
      setMode('table');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('brief', false);
    }
  }

  async function buildCustom() {
    if (!customTitle.trim() || !customBody.trim()) {
      setError('Add a title and source note before composing.');
      return;
    }

    setError(null);
    resetDraft();
    setLoad('custom', true);
    try {
      const result = await generateCustomSlides(customTitle, customBody, customImage);
      setArticle({
        title: customTitle,
        source: 'Manual brief',
        fullText: customBody,
        url: '',
      });
      setSlides(result.slides || []);
      setCaption(result.caption || '');
      setQuality(result.quality || null);
      setImageUrls(result.imageUrls || []);
      setImagePaths(result.imagePaths || []);
      setMode('table');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('custom', false);
    }
  }

  async function publishNow() {
    if (!imagePaths.length) return;
    setError(null);
    setLoad('launch', true);
    try {
      const result = await postCarousel(imagePaths, caption, article?.url);
      setPosted(result.postId);
      await refreshSystems();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('launch', false);
    }
  }

  async function scheduleDraft() {
    if (!scheduledAt) {
      setError('Choose a launch time first.');
      return;
    }
    if (!imagePaths.length) {
      setError('Compose a carousel before adding it to the runway.');
      return;
    }

    setError(null);
    try {
      await addToQueue({
        title: article?.title || customTitle || 'Frontrun draft',
        imagePaths,
        caption,
        scheduledAt: new Date(scheduledAt).toISOString(),
      });
      setQueueSuccess(true);
      await refreshSystems();
      setTimeout(() => setQueueSuccess(false), 3500);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function removeQueued(id) {
    await removeFromQueue(id);
    await refreshSystems();
  }

  async function runAutopilot() {
    setError(null);
    setLoad('autopilot', true);
    try {
      await runPipeline();
      await refreshSystems();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('autopilot', false);
    }
  }

  async function toggleScheduler(enabled) {
    setError(null);
    try {
      if (enabled) await startScheduler(cronExpression);
      else await stopScheduler();
      await refreshSystems();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  function handleImageSelect(file) {
    if (!file) return;
    setCustomImage(file);
    const reader = new FileReader();
    reader.onload = (event) => setCustomPreview(event.target.result);
    reader.readAsDataURL(file);
  }

  const currentSignal = useMemo(() => {
    if (article) return article;
    return trending[selectedSignal] || null;
  }, [article, trending, selectedSignal]);

  const heat = signalHeat(currentSignal, selectedSignal);
  const qualityScore = quality?.score ?? 0;
  const clearance = quality
    ? qualityScore >= 90
      ? 'Cleared'
      : qualityScore >= 75
        ? 'Review'
        : 'Hold'
    : 'Pending';
  const qualityChecks = quality?.checks || {};
  const pendingQueue = postQueue.filter((item) => item.status === 'pending');
  const displayTitle = currentSignal?.title || 'Find the story before the feed catches up';
  const displayCopy =
    currentSignal?.fullText ||
    currentSignal?.description ||
    currentSignal?.summary ||
    'Pull a live signal, choose the angle, compose the carousel, clear the risk checks, and launch from one focused surface.';

  return (
    <main className={`fr-app ${booting ? 'is-booting' : 'is-live'}`}>
      <div className="boot-sequence" aria-hidden={!booting}>
        <div className="boot-frame">
          <span className="boot-corner boot-corner-a" />
          <span className="boot-corner boot-corner-b" />
          <span className="boot-corner boot-corner-c" />
          <span className="boot-corner boot-corner-d" />
          <div className="boot-mark">F</div>
          <strong>Frontrun</strong>
          <small>Signal studio coming online</small>
        </div>
      </div>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="cursor-glow" aria-hidden="true" />
      <div className="mirror-hall" aria-hidden="true">
        <span className="mirror-ceiling" />
        <span className="mirror-floor" />
        <span className="mirror-wall mirror-wall-left" />
        <span className="mirror-wall mirror-wall-right" />
        <span className="mirror-vanish" />
        {Array.from({ length: 9 }).map((_, index) => (
          <span className="mirror-slice" key={index} style={{ '--slice': index }} />
        ))}
      </div>

      <header className="fr-topbar">
        <button className="brand-lockup" onClick={() => setMode('brief')} type="button">
          <span className="brand-mark">F</span>
          <span>
            <strong>Frontrun</strong>
            <small>Get in before the feed does.</small>
          </span>
        </button>

        <div className="command-bar">
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') pullSignal(false);
            }}
            placeholder="Search a market, creator niche, company, or story"
          />
          <button type="button" onClick={() => pullSignal(false)} disabled={loading.wire}>
            {loading.wire ? 'Pulling' : 'Pull Signal'}
          </button>
        </div>

        <nav className="surface-tabs" aria-label="Frontrun surfaces">
          {[
            ['brief', 'Brief'],
            ['wire', 'Wire'],
            ['table', 'Table'],
            ['runway', 'Runway'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={mode === key ? 'active' : ''}
              onClick={() => setMode(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      {error && (
        <div className="fr-error" role="alert">
          <span>Hold</span>
          {error}
        </div>
      )}

      <div className="live-tape" aria-label="Live signal tape">
        <div className="tape-track">
          {[...Array(2)].map((_, groupIndex) => (
            <div className="tape-group" key={groupIndex}>
              <span>Heat {heat} climbing</span>
              <span>Low overlap with recent posts</span>
              <span>Peak window forming</span>
              <span>{pendingQueue.length} drafts on runway</span>
              <span>{schedulerStatus?.running ? 'Autopilot live' : 'Autopilot paused'}</span>
            </div>
          ))}
        </div>
      </div>

      <section className="fr-stage">
        <aside className="wire-strip" aria-label="The Wire">
          <div className="section-kicker">The Wire</div>
          <div className="wire-list">
            {(trending.length ? trending : [currentSignal]).filter(Boolean).slice(0, 7).map((item, index) => (
              <button
                key={item.url || item.title || index}
                type="button"
                className={`wire-item ${!article && selectedSignal === index ? 'selected' : ''}`}
                style={{ '--stagger': `${index * 70}ms` }}
                onClick={() => {
                  setArticle(null);
                  setSelectedSignal(index);
                  setTopic(item.title || topic);
                  resetDraft();
                  setMode('brief');
                }}
              >
                <span className="wire-heat">{signalHeat(item, index)}</span>
                <span>
                  <strong>{shortText(item.title, 74)}</strong>
                  <small>{sourceName(item)}</small>
                </span>
              </button>
            ))}
          </div>
          <button type="button" className="ghost-action" onClick={() => pullSignal(true)} disabled={loading.wire}>
            Refresh Wire
          </button>
        </aside>

        <section className={`brief-surface ${mode !== 'brief' ? 'muted-surface' : ''}`}>
          <div className="brief-copy">
            <div className="section-kicker">Top of the Brief</div>
            <div className="brief-meta">
              <span>Heat {heat}</span>
              <span>{sourceName(currentSignal)}</span>
              <span>{article ? 'Sourced' : 'Climbing'}</span>
            </div>
            <h1>{displayTitle}</h1>
            <p>{shortText(displayCopy, 250)}</p>

            <div className="angle-stack" aria-label="Angle Engine">
              <label className="angle-choice">
                <input type="radio" name="angle" defaultChecked />
                <span>Speed is the new moat</span>
              </label>
              <label className="angle-choice">
                <input type="radio" name="angle" />
                <span>What this means for small teams</span>
              </label>
              <label className="angle-choice">
                <input type="radio" name="angle" />
                <span>Make it sharper for founders</span>
              </label>
            </div>

            <div className="brief-actions">
              <button type="button" className="primary-action" onClick={buildBrief} disabled={loading.brief}>
                {loading.brief ? 'Building' : 'Build This'}
              </button>
              <button type="button" className="secondary-action" onClick={() => pullSignal(true)} disabled={loading.wire}>
                Skip
              </button>
              <button type="button" className="secondary-action" onClick={() => setMode('wire')}>
                Save to Wire
              </button>
            </div>
          </div>

          <div className="artifact-preview" aria-label="Carousel preview">
            <div className="artifact-orbit" aria-hidden="true">
              <span>Trend velocity</span>
              <span>Hook clarity</span>
              <span>Launch window</span>
            </div>
            {(loading.brief || loading.custom) && (
              <div className="build-overlay">
                <span />
                <strong>Composing signal</strong>
              </div>
            )}
            <div className="signal-field">
              {Array.from({ length: 18 }).map((_, index) => (
                <span key={index} style={{ '--delay': `${index * 0.17}s`, '--left': `${8 + (index * 23) % 86}%` }} />
              ))}
            </div>
            <div className="slide-stack">
              <div className="preview-slide primary-slide">
                {imageUrls[0] ? <img src={`${IMG_BASE}${imageUrls[0]}`} alt="Hook slide" /> : null}
                <span>{slides[0]?.badge || 'Signal'}</span>
                <strong>{slides[0]?.headline || displayTitle}</strong>
              </div>
              <div className="preview-slide detail-slide">
                {imageUrls[1] ? <img src={`${IMG_BASE}${imageUrls[1]}`} alt="Detail slide" /> : null}
                <p>{slides[1]?.body || 'The draft forms here after Frontrun builds the brief.'}</p>
              </div>
            </div>
          </div>
        </section>

        <aside className="clearance-panel">
          <div className="section-kicker">Clearance</div>
          <div className={`clearance-verdict ${clearance.toLowerCase()}`}>
            <strong>{clearance}</strong>
            <span>{quality ? `${qualityScore}/100` : 'No draft yet'}</span>
          </div>
          <div className="clearance-meter" style={{ '--score': `${quality ? qualityScore : 18}%` }}>
            <span />
          </div>
          <div className="guard-list">
            <div className="guard-row">
              <span>Fact grounding</span>
              <strong>{slides.length ? 'Ready' : 'Pending'}</strong>
            </div>
            <div className="guard-row">
              <span>Detail pacing</span>
              <strong>{qualityChecks.bodyWordCount || 0} words</strong>
            </div>
            <div className="guard-row">
              <span>Highlight phrase</span>
              <strong>{qualityChecks.highlightCount || 0}</strong>
            </div>
            <div className="guard-row">
              <span>Hashtag set</span>
              <strong>{qualityChecks.hashtagCount || 0}/5</strong>
            </div>
          </div>
          {quality?.warnings?.length ? (
            <ul className="clearance-notes">
              {quality.warnings.slice(0, 3).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p className="quiet-note">A draft needs to pass clearance before it reaches the runway.</p>
          )}
        </aside>
      </section>

      <section className="lower-grid">
        <div className={`table-surface ${mode === 'table' ? 'spotlight' : ''}`}>
          <div className="surface-head">
            <div>
              <span className="section-kicker">The Table</span>
              <h2>Carousel light table</h2>
            </div>
            <button type="button" className="secondary-action compact" onClick={() => setMode('brief')}>
              Back to Brief
            </button>
          </div>

          <div className="light-table">
            {[0, 1].map((index) => (
              <article className="frame-card" key={index}>
                <div className="frame-image">
                  {imageUrls[index] ? <img src={`${IMG_BASE}${imageUrls[index]}`} alt={`Frame ${index + 1}`} /> : null}
                </div>
                <div className="frame-meta">
                  <span>Frame {index + 1}</span>
                  <strong>{slides[index]?.type === 'detail' ? 'Context' : 'Hook'}</strong>
                </div>
                <p>
                  {slides[index]?.headline ||
                    slides[index]?.body ||
                    (index === 0 ? 'Build a brief to create the hook frame.' : 'Context frame appears after generation.')}
                </p>
              </article>
            ))}
          </div>

          <label className="caption-editor">
            <span>Caption composer</span>
            <textarea value={caption} onChange={(event) => setCaption(event.target.value)} rows={5} />
          </label>
        </div>

        <div className="compose-panel">
          <div className="surface-head">
            <div>
              <span className="section-kicker">Angle Engine</span>
              <h2>Manual brief</h2>
            </div>
          </div>
          <input
            value={customTitle}
            onChange={(event) => setCustomTitle(event.target.value)}
            placeholder="Headline or post idea"
          />
          <textarea
            value={customBody}
            onChange={(event) => setCustomBody(event.target.value)}
            placeholder="Paste source notes, facts, or your angle"
            rows={6}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden-input"
            onChange={(event) => handleImageSelect(event.target.files?.[0])}
          />
          <button type="button" className="upload-well" onClick={() => fileInputRef.current?.click()}>
            {customPreview ? <img src={customPreview} alt="Manual upload preview" /> : <span>Add a source image</span>}
          </button>
          <button type="button" className="primary-action full" onClick={buildCustom} disabled={loading.custom}>
            {loading.custom ? 'Composing' : 'Compose Manual Brief'}
          </button>
        </div>

        <div className={`runway-panel ${mode === 'runway' ? 'spotlight' : ''}`}>
          <div className="surface-head">
            <div>
              <span className="section-kicker">The Runway</span>
              <h2>Launch desk</h2>
            </div>
            <span className="queue-count">{pendingQueue.length} pending</span>
          </div>

          <div className="launch-actions">
            {posted ? (
              <div className="posted-state">Posted: {posted}</div>
            ) : (
              <button type="button" className="primary-action full" onClick={publishNow} disabled={!imagePaths.length || loading.launch}>
                {loading.launch ? 'Shipping' : 'Ship Now'}
              </button>
            )}
            <input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} />
            <button type="button" className="secondary-action full" onClick={scheduleDraft}>
              {queueSuccess ? 'Added to Runway' : 'Add to Runway'}
            </button>
          </div>

          <div className="runway-list">
            {postQueue.slice(0, 5).map((item) => (
              <div className="runway-item" key={item.id}>
                <span>{formatTime(item.scheduledAt)}</span>
                <strong>{shortText(item.title || 'Custom post', 58)}</strong>
                <em>{item.status}</em>
                {item.status === 'pending' && (
                  <button type="button" onClick={() => removeQueued(item.id)}>
                    Cancel
                  </button>
                )}
              </div>
            ))}
            {!postQueue.length && <p className="quiet-note">Approved drafts will line up here.</p>}
          </div>

          <div className="autopilot">
            <select value={cronExpression} onChange={(event) => setCronExpression(event.target.value)}>
              {CRON_PRESETS.map((preset) => (
                <option value={preset.value} key={preset.value}>
                  {preset.label}
                </option>
              ))}
            </select>
            <div className="autopilot-buttons">
              <button type="button" className="secondary-action" onClick={() => toggleScheduler(true)}>
                Start
              </button>
              <button type="button" className="secondary-action" onClick={() => toggleScheduler(false)}>
                Stop
              </button>
              <button type="button" className="secondary-action" onClick={runAutopilot} disabled={loading.autopilot}>
                Run Once
              </button>
            </div>
            <small>{schedulerStatus?.running ? 'Autopilot running' : 'Autopilot paused'}</small>
          </div>
        </div>
      </section>
    </main>
  );
}
