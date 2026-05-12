import { useState, useEffect } from 'react';
import {
  fetchNews,
  generateSlides,
  postCarousel,
  runPipeline,
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
  getTrending,
} from './api';
import './App.css';

const CRON_PRESETS = [
  { label: 'Every hour',       value: '0 * * * *' },
  { label: 'Every 6 hours',    value: '0 */6 * * *' },
  { label: 'Every 12 hours',   value: '0 */12 * * *' },
  { label: 'Once a day (9am)', value: '0 9 * * *' },
  { label: 'Twice a day',      value: '0 9,18 * * *' },
];

const IMG_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace('/api', '');

export default function App() {
  const [topic, setTopic]           = useState('');
  const [article, setArticle]       = useState(null);
  const [seenUrls, setSeenUrls]     = useState([]);
  const [trending, setTrending]     = useState([]);
  const [loadingTrend, setLoadingTrend] = useState(false);
  const [slides, setSlides]         = useState([]);
  const [caption, setCaption]       = useState('');
  const [imageUrls, setImageUrls]   = useState([]);
  const [imagePaths, setImagePaths] = useState([]);
  const [loading, setLoading]       = useState({ news: false, generate: false, post: false, pipeline: false });
  const [error, setError]           = useState(null);
  const [posted, setPosted]         = useState(null);
  const [activeTab, setActiveTab]   = useState('manual');
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [cronExpression, setCronExpression]   = useState('0 9 * * *');

  useEffect(() => {
    fetchStatus();
    loadTrending();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadTrending() {
    setLoadingTrend(true);
    try { setTrending(await getTrending()); } catch {}
    finally { setLoadingTrend(false); }
  }

  async function fetchStatus() {
    try { setSchedulerStatus(await getSchedulerStatus()); } catch {}
  }

  function setLoad(key, val) {
    setLoading((p) => ({ ...p, [key]: val }));
  }

  async function handleFetchNews(refresh = false) {
    if (!topic.trim()) return setError('Enter a topic to scan');
    setError(null);
    setSlides([]);
    setImageUrls([]);
    setPosted(null);
    setLoad('news', true);
    try {
      const exclude = refresh && article ? [...seenUrls] : [];
      const art = await fetchNews(topic, exclude);
      setArticle(art);
      setSeenUrls((prev) => [...new Set([...prev, art.url])]);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('news', false);
    }
  }

  async function handleGenerate() {
    if (!article) return;
    setError(null);
    setSlides([]);
    setImageUrls([]);
    setPosted(null);
    setLoad('generate', true);
    try {
      const result = await generateSlides(article, topic);
      setSlides(result.slides);
      setCaption(result.caption);
      setImageUrls(result.imageUrls);
      setImagePaths(result.imagePaths);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('generate', false);
    }
  }

  async function handlePost() {
    setError(null);
    setLoad('post', true);
    try {
      const result = await postCarousel(imagePaths, caption);
      setPosted(result.postId);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('post', false);
    }
  }

  async function handleRunPipeline() {
    setError(null);
    setLoad('pipeline', true);
    try {
      const result = await runPipeline();
      alert(`Posted! "${result.article}"`);
      fetchStatus();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('pipeline', false);
    }
  }

  async function handleStartScheduler() {
    try { await startScheduler(cronExpression); fetchStatus(); }
    catch (e) { setError(e.response?.data?.error || e.message); }
  }

  async function handleStopScheduler() {
    try { await stopScheduler(); fetchStatus(); } catch (e) { setError(e.message); }
  }

  // Step states
  const step1Done   = !!article;
  const step2Done   = slides.length > 0;
  const step3Done   = !!posted;

  return (
    <div className="app">
      {/* ── HEADER ── */}
      <header className="header">
        <div className="header-inner">
          <div className="header-logo">
            <div className="logo-icon">🤖</div>
            <div>
              <h1>CAROUSEL.AI</h1>
              <p>AUTOMATED INSTAGRAM CONTENT PIPELINE</p>
            </div>
          </div>
          <div className="header-status">
            <div className="status-dot" />
            SYSTEM ONLINE
          </div>
        </div>
      </header>

      <main className="main">
        {/* ── TABS ── */}
        <div className="tabs">
          <button className={activeTab === 'manual' ? 'tab active' : 'tab'} onClick={() => setActiveTab('manual')}>
            MANUAL
          </button>
          <button className={activeTab === 'auto' ? 'tab active' : 'tab'} onClick={() => setActiveTab('auto')}>
            AUTO SCHEDULER
          </button>
        </div>

        {/* ── ERROR ── */}
        {error && <div className="error-banner">⚠ {error}</div>}

        {/* ── TRENDING PANEL ── */}
        {activeTab === 'manual' && (
          <div className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.8rem' }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--cyan)', letterSpacing: '2px', textTransform: 'uppercase' }}>
                ⚡ HN TRENDING NOW
              </span>
              <button className="btn btn-cyan" onClick={loadTrending} disabled={loadingTrend}
                style={{ padding: '0.3rem 0.8rem', fontSize: '0.7rem' }}>
                {loadingTrend ? '...' : 'REFRESH'}
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem', maxHeight: '220px', overflowY: 'auto' }}>
              {trending.slice(0, 15).map((s, i) => (
                <div key={i}
                  onClick={() => { setTopic(s.title); setSeenUrls([]); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.8rem',
                    padding: '0.5rem 0.7rem', background: 'var(--bg3)',
                    border: '1px solid var(--border)', borderRadius: '6px',
                    cursor: 'pointer', transition: 'border-color 0.2s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--cyan)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--yellow)', minWidth: '45px' }}>
                    ▲ {s.points}
                  </span>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text)', flex: 1, lineHeight: 1.3 }}>{s.title}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: '0.65rem', color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>
                    {s.source}
                  </span>
                </div>
              ))}
              {!loadingTrend && trending.length === 0 && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: '0.75rem', color: 'var(--text-mute)', padding: '0.5rem' }}>
                  Click REFRESH to load trending stories
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── MANUAL MODE ── */}
        {activeTab === 'manual' && (
          <div className="workflow">

            {/* STEP 1 — SCAN */}
            <div className={`step ${step1Done ? 'done' : 'active'}`}>
              <div className="step-connector">
                <div className="step-num">{step1Done ? '✓' : '01'}</div>
                <div className="step-line" />
              </div>
              <div className="step-body">
                <div className="step-header">
                  <span className="step-label">SCAN NEWS</span>
                  <span className="step-tag">{step1Done ? 'COMPLETE' : 'PENDING'}</span>
                </div>
                <div className="panel">
                  <div className="topic-input-row">
                    <div className="topic-input-wrap">
                      <span className="input-prefix">&gt;</span>
                      <input
                        type="text"
                        placeholder="openai / anthropic / ai layoffs..."
                        value={topic}
                        onChange={(e) => { setTopic(e.target.value); setSeenUrls([]); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleFetchNews(false)}
                      />
                    </div>
                    <button className="btn btn-cyan" onClick={() => handleFetchNews(false)} disabled={loading.news}>
                      {loading.news ? 'SCANNING...' : 'SCAN'}
                    </button>
                    {article && (
                      <button className="btn btn-yellow" onClick={() => handleFetchNews(true)} disabled={loading.news}>
                        {loading.news ? '...' : 'REFRESH'}
                      </button>
                    )}
                  </div>

                  {article && (
                    <div className="article-card" style={{ marginTop: '1rem' }}>
                      <div className="article-meta">
                        <span className="source-badge">{article.source}</span>
                        {article.pubDate && <span className="pub-date">{new Date(article.pubDate).toLocaleDateString()}</span>}
                        {article.points && <span className="pts-badge">{article.points} PTS</span>}
                      </div>
                      <div className="article-title">{article.title}</div>
                      <div className="article-preview">{article.fullText.slice(0, 180)}...</div>
                      <a href={article.url} target="_blank" rel="noreferrer" className="article-link">
                        &gt; READ FULL ARTICLE
                      </a>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* STEP 2 — GENERATE */}
            <div className={`step ${step2Done ? 'done' : step1Done ? 'active' : ''}`}>
              <div className="step-connector">
                <div className="step-num">{step2Done ? '✓' : '02'}</div>
                <div className="step-line" />
              </div>
              <div className="step-body">
                <div className="step-header">
                  <span className="step-label">GENERATE CAROUSEL</span>
                  <span className="step-tag">{step2Done ? 'COMPLETE' : step1Done ? 'READY' : 'LOCKED'}</span>
                </div>
                <div className="panel">
                  <div className="btn-row" style={{ marginBottom: slides.length ? '1.2rem' : 0 }}>
                    <button className="btn btn-cyan" onClick={handleGenerate} disabled={!article || loading.generate}>
                      {loading.generate ? 'GENERATING...' : 'GENERATE SLIDES'}
                    </button>
                  </div>

                  {slides.length > 0 && (
                    <>
                      <div className="slides-label">SLIDE PREVIEW — {slides.length} FRAMES</div>
                      <div className="slides-grid">
                        {slides.map((slide, i) => (
                          <div key={i} className="slide-card">
                            {imageUrls[i] && (
                              <img src={`${IMG_BASE}${imageUrls[i]}`} alt={`Slide ${i + 1}`} className="slide-img" />
                            )}
                            <div className="slide-info">
                              <span className="slide-type">FRAME {i + 1}</span>
                              <div className="slide-headline">{slide.headline}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* STEP 3 — DEPLOY */}
            <div className={`step ${step3Done ? 'done' : step2Done ? 'active' : ''}`}>
              <div className="step-connector">
                <div className="step-num">{step3Done ? '✓' : '03'}</div>
                <div className="step-line" style={{ minHeight: 0, flex: 0 }} />
              </div>
              <div className="step-body">
                <div className="step-header">
                  <span className="step-label">DEPLOY TO INSTAGRAM</span>
                  <span className="step-tag">{step3Done ? 'POSTED' : step2Done ? 'READY' : 'LOCKED'}</span>
                </div>
                <div className="panel">
                  {slides.length > 0 && (
                    <>
                      <div className="caption-section">
                        <span className="caption-label">CAPTION PAYLOAD</span>
                        <textarea
                          value={caption}
                          onChange={(e) => setCaption(e.target.value)}
                          rows={5}
                        />
                      </div>

                      {posted ? (
                        <div className="posted-success">
                          ✓ CAROUSEL DEPLOYED — POST ID: {posted}
                        </div>
                      ) : (
                        <button className="btn btn-instagram btn-full" onClick={handlePost} disabled={loading.post}>
                          {loading.post ? 'DEPLOYING...' : '▶ DEPLOY CAROUSEL TO INSTAGRAM'}
                        </button>
                      )}
                    </>
                  )}

                  {!slides.length && (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--text-mute)' }}>
                      Complete steps 01 and 02 to unlock deployment.
                    </div>
                  )}
                </div>
              </div>
            </div>

          </div>
        )}

        {/* ── AUTO SCHEDULER ── */}
        {activeTab === 'auto' && (
          <div className="panel scheduler-panel">
            <div className="scheduler-info">
              &gt; AUTONOMOUS MODE — system selects top viral AI news, generates carousel, deploys to Instagram.<br />
              &gt; TOPICS rotate: OpenAI · Anthropic · AI layoffs · Google AI · AI funding · and more.<br />
              &gt; NO human input required.
            </div>

            <div className="field">
              <label>POSTING FREQUENCY</label>
              <select value={cronExpression} onChange={(e) => setCronExpression(e.target.value)}>
                {CRON_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="scheduler-actions">
              <button className="btn btn-green" onClick={handleStartScheduler} disabled={schedulerStatus?.running}>
                ▶ START
              </button>
              <button className="btn btn-red" onClick={handleStopScheduler} disabled={!schedulerStatus?.running}>
                ■ STOP
              </button>
              <button className="btn btn-cyan" onClick={handleRunPipeline} disabled={loading.pipeline}>
                {loading.pipeline ? 'RUNNING...' : '⚡ RUN NOW'}
              </button>
            </div>

            {schedulerStatus && (
              <div className={`status-box ${schedulerStatus.running ? 'status-active' : ''}`}>
                <div className="status-row">
                  <span className="s-key">STATUS</span>
                  <span className="s-val">{schedulerStatus.running ? '🟢 ONLINE' : '🔴 OFFLINE'}</span>
                </div>
                <div className="status-divider" />
                {schedulerStatus.schedule && (
                  <div className="status-row">
                    <span className="s-key">SCHEDULE</span>
                    <span className="s-val">{CRON_PRESETS.find(p => p.value === schedulerStatus.schedule)?.label || schedulerStatus.schedule}</span>
                  </div>
                )}
                {schedulerStatus.nextTopic && (
                  <div className="status-row">
                    <span className="s-key">NEXT TOPIC</span>
                    <span className="s-val">{schedulerStatus.nextTopic}</span>
                  </div>
                )}
                {schedulerStatus.lastRun && (
                  <div className="status-row">
                    <span className="s-key">LAST RUN</span>
                    <span className="s-val">{new Date(schedulerStatus.lastRun).toLocaleString()}</span>
                  </div>
                )}
                {schedulerStatus.totalPosted > 0 && (
                  <div className="status-row">
                    <span className="s-key">TOTAL POSTED</span>
                    <span className="s-val" style={{ color: 'var(--green)' }}>{schedulerStatus.totalPosted}</span>
                  </div>
                )}
                {schedulerStatus.lastResult && (
                  <div className="status-row">
                    <span className="s-key">LAST POST</span>
                    <span className="s-val">
                      {schedulerStatus.lastResult.success
                        ? `✓ "${schedulerStatus.lastResult.article?.slice(0, 60)}..."`
                        : `✗ ${schedulerStatus.lastResult.error}`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
