import { useState, useEffect, useRef } from 'react';
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

  // Create Your Own state
  const [customTitle, setCustomTitle]   = useState('');
  const [customBody, setCustomBody]     = useState('');
  const [customImage, setCustomImage]   = useState(null);
  const [customPreview, setCustomPreview] = useState(null);
  const fileInputRef = useRef(null);

  // Queue state
  const [postQueue, setPostQueue]         = useState([]);
  const [scheduleMode, setScheduleMode]   = useState('now'); // 'now' | 'schedule'
  const [scheduledAt, setScheduledAt]     = useState('');
  const [queueSuccess, setQueueSuccess]   = useState(false);
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [cronExpression, setCronExpression]   = useState('0 9 * * *');

  useEffect(() => {
    fetchStatus();
    loadTrending();
    loadQueue();
    const interval = setInterval(() => { fetchStatus(); loadQueue(); }, 10000);
    return () => clearInterval(interval);
  }, []);

  async function loadQueue() {
    try { setPostQueue(await getQueue()); } catch {}
  }

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
      const result = await postCarousel(imagePaths, caption, article?.url);
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

  async function handleSchedulePost() {
    if (!scheduledAt) return setError('Pick a date and time to schedule');
    setError(null);
    try {
      await addToQueue({ title: customTitle, imagePaths, caption, scheduledAt: new Date(scheduledAt).toISOString() });
      setQueueSuccess(true);
      loadQueue();
      setTimeout(() => setQueueSuccess(false), 4000);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function handleCancelQueued(id) {
    await removeFromQueue(id);
    loadQueue();
  }

  async function handleCustomGenerate() {
    if (!customTitle.trim() || !customBody.trim()) return setError('Title and content are required');
    setError(null);
    setSlides([]);
    setImageUrls([]);
    setPosted(null);
    setLoad('generate', true);
    try {
      const result = await generateCustomSlides(customTitle, customBody, customImage);
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

  function handleImageSelect(file) {
    if (!file) return;
    setCustomImage(file);
    const reader = new FileReader();
    reader.onload = (e) => setCustomPreview(e.target.result);
    reader.readAsDataURL(file);
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
          <button className={activeTab === 'custom' ? 'tab active' : 'tab'} onClick={() => setActiveTab('custom')}>
            CREATE YOUR OWN
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
                              <span className="slide-type">FRAME {i + 1} — {slide.type === 'hook' ? 'PHOTO' : 'TEXT'}</span>
                              <div className="slide-headline">
                                {slide.type === 'hook' ? slide.headline : slide.title}
                              </div>
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

        {/* ── CREATE YOUR OWN ── */}
        {activeTab === 'custom' && (
          <div className="workflow">

            {/* INPUT */}
            <div className={`step ${slides.length > 0 ? 'done' : 'active'}`}>
              <div className="step-connector">
                <div className="step-num">{slides.length > 0 ? '✓' : '01'}</div>
                <div className="step-line" />
              </div>
              <div className="step-body">
                <div className="step-header">
                  <span className="step-label">YOUR CONTENT</span>
                  <span className="step-tag">{slides.length > 0 ? 'COMPLETE' : 'PENDING'}</span>
                </div>
                <div className="panel" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

                  {/* Title */}
                  <div className="field">
                    <label>ARTICLE TITLE</label>
                    <input
                      type="text"
                      placeholder="Enter the headline..."
                      value={customTitle}
                      onChange={(e) => setCustomTitle(e.target.value)}
                      style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '0.85rem' }}
                    />
                  </div>

                  {/* Body */}
                  <div className="field">
                    <label>ARTICLE CONTENT</label>
                    <textarea
                      placeholder="Paste the article body here..."
                      value={customBody}
                      onChange={(e) => setCustomBody(e.target.value)}
                      rows={6}
                      style={{ width: '100%', padding: '0.6rem 0.8rem', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '0.82rem', resize: 'vertical' }}
                    />
                  </div>

                  {/* Image upload */}
                  <div className="field">
                    <label>SLIDE IMAGE <span style={{ color: 'var(--text-mute)', fontWeight: 400 }}>(optional — AI generates one if not provided)</span></label>
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => { e.preventDefault(); handleImageSelect(e.dataTransfer.files[0]); }}
                      style={{
                        border: '2px dashed var(--border)', borderRadius: '8px',
                        padding: '1.5rem', textAlign: 'center', cursor: 'pointer',
                        background: 'var(--bg3)', transition: 'border-color 0.2s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--cyan)'}
                      onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                    >
                      {customPreview ? (
                        <img src={customPreview} alt="preview" style={{ maxHeight: '160px', borderRadius: '6px', objectFit: 'cover' }} />
                      ) : (
                        <span style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--text-dim)' }}>
                          ↑ DRAG & DROP or click to upload image
                        </span>
                      )}
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      style={{ display: 'none' }}
                      onChange={(e) => handleImageSelect(e.target.files[0])}
                    />
                    {customImage && (
                      <button
                        onClick={() => { setCustomImage(null); setCustomPreview(null); }}
                        style={{ marginTop: '0.4rem', background: 'none', border: 'none', color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: '0.72rem', cursor: 'pointer' }}
                      >
                        ✕ Remove image
                      </button>
                    )}
                  </div>

                  <button className="btn btn-cyan" onClick={handleCustomGenerate} disabled={loading.generate}>
                    {loading.generate ? 'GENERATING...' : '⚡ GENERATE CAROUSEL'}
                  </button>
                </div>
              </div>
            </div>

            {/* PREVIEW */}
            {slides.length > 0 && (
              <div className="step done">
                <div className="step-connector">
                  <div className="step-num">✓</div>
                  <div className="step-line" />
                </div>
                <div className="step-body">
                  <div className="step-header">
                    <span className="step-label">CAROUSEL PREVIEW</span>
                    <span className="step-tag">READY</span>
                  </div>
                  <div className="panel">
                    <div className="slides-label">SLIDE PREVIEW — {slides.length} FRAMES</div>
                    <div className="slides-grid">
                      {slides.map((slide, i) => (
                        <div key={i} className="slide-card">
                          {imageUrls[i] && (
                            <img src={`${IMG_BASE}${imageUrls[i]}`} alt={`Slide ${i + 1}`} className="slide-img" />
                          )}
                          <div className="slide-info">
                            <span className="slide-type">FRAME {i + 1} — {slide.type === 'hook' ? 'PHOTO' : 'TEXT'}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* DEPLOY / SCHEDULE */}
            {slides.length > 0 && (
              <div className={`step ${posted || queueSuccess ? 'done' : 'active'}`}>
                <div className="step-connector">
                  <div className="step-num">{posted || queueSuccess ? '✓' : '02'}</div>
                  <div className="step-line" style={{ minHeight: 0, flex: 0 }} />
                </div>
                <div className="step-body">
                  <div className="step-header">
                    <span className="step-label">DEPLOY TO INSTAGRAM</span>
                    <span className="step-tag">{posted ? 'POSTED' : queueSuccess ? 'SCHEDULED' : 'READY'}</span>
                  </div>
                  <div className="panel">
                    <div className="caption-section">
                      <span className="caption-label">CAPTION PAYLOAD</span>
                      <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={4} />
                    </div>

                    {/* Post Now / Schedule toggle */}
                    <div style={{ display: 'flex', gap: '0.6rem', margin: '1rem 0 0.8rem' }}>
                      {['now', 'schedule'].map(mode => (
                        <button key={mode}
                          onClick={() => setScheduleMode(mode)}
                          style={{
                            flex: 1, padding: '0.55rem', fontFamily: 'var(--mono)', fontSize: '0.75rem',
                            fontWeight: 700, letterSpacing: '1px', textTransform: 'uppercase',
                            border: `1px solid ${scheduleMode === mode ? 'var(--cyan)' : 'var(--border)'}`,
                            background: scheduleMode === mode ? 'rgba(0,229,255,0.1)' : 'var(--bg3)',
                            color: scheduleMode === mode ? 'var(--cyan)' : 'var(--text-dim)',
                            borderRadius: '6px', cursor: 'pointer', transition: 'all 0.15s',
                          }}>
                          {mode === 'now' ? '▶ Post Now' : '🕐 Schedule'}
                        </button>
                      ))}
                    </div>

                    {scheduleMode === 'now' && (
                      posted ? (
                        <div className="posted-success">✓ CAROUSEL DEPLOYED — POST ID: {posted}</div>
                      ) : (
                        <button className="btn btn-instagram btn-full" onClick={handlePost} disabled={loading.post}>
                          {loading.post ? 'DEPLOYING...' : '▶ DEPLOY CAROUSEL TO INSTAGRAM'}
                        </button>
                      )
                    )}

                    {scheduleMode === 'schedule' && (
                      queueSuccess ? (
                        <div className="posted-success">✓ ADDED TO QUEUE — will post at scheduled time</div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                          <input
                            type="datetime-local"
                            value={scheduledAt}
                            onChange={(e) => setScheduledAt(e.target.value)}
                            style={{
                              width: '100%', padding: '0.65rem 0.8rem',
                              background: '#ffffff', border: '1px solid var(--border)',
                              borderRadius: '6px', color: '#111111',
                              fontFamily: 'var(--mono)', fontSize: '0.88rem',
                              colorScheme: 'light',
                            }}
                          />
                          <button className="btn btn-cyan btn-full" onClick={handleSchedulePost}>
                            + ADD TO QUEUE
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* QUEUE PANEL */}
            {postQueue.length > 0 && (
              <div className="panel" style={{ marginTop: '1.5rem' }}>
                <div style={{ fontFamily: 'var(--mono)', fontSize: '0.7rem', color: 'var(--cyan)', letterSpacing: '2px', marginBottom: '0.8rem' }}>
                  📅 SCHEDULED QUEUE — {postQueue.filter(q => q.status === 'pending').length} PENDING
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {postQueue.map(item => (
                    <div key={item.id} style={{
                      display: 'flex', alignItems: 'center', gap: '0.8rem',
                      padding: '0.6rem 0.8rem', background: 'var(--bg3)',
                      border: `1px solid ${item.status === 'posted' ? 'var(--green)' : item.status === 'failed' ? '#ff4444' : 'var(--border)'}`,
                      borderRadius: '6px',
                    }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.78rem', color: 'var(--text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {item.title || 'Custom Post'}
                        </div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: '0.68rem', color: 'var(--text-dim)', marginTop: '0.2rem' }}>
                          🕐 {new Date(item.scheduledAt).toLocaleString()}
                        </div>
                      </div>
                      <span style={{
                        fontFamily: 'var(--mono)', fontSize: '0.65rem', fontWeight: 700, letterSpacing: '1px',
                        padding: '0.2rem 0.5rem', borderRadius: '4px',
                        background: item.status === 'posted' ? 'rgba(0,255,0,0.1)' : item.status === 'failed' ? 'rgba(255,0,0,0.1)' : 'rgba(0,229,255,0.1)',
                        color: item.status === 'posted' ? 'var(--green)' : item.status === 'failed' ? '#ff4444' : 'var(--cyan)',
                      }}>
                        {item.status.toUpperCase()}
                      </span>
                      {item.status === 'pending' && (
                        <button onClick={() => handleCancelQueued(item.id)} style={{
                          background: 'none', border: '1px solid var(--border)', borderRadius: '4px',
                          color: 'var(--text-mute)', fontFamily: 'var(--mono)', fontSize: '0.7rem',
                          padding: '0.2rem 0.5rem', cursor: 'pointer',
                        }}>
                          CANCEL
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

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
