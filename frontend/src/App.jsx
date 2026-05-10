import { useState, useEffect } from 'react';
import {
  fetchNews,
  generateSlides,
  postCarousel,
  runPipeline,
  startScheduler,
  stopScheduler,
  getSchedulerStatus,
} from './api';
import './App.css';

const CRON_PRESETS = [
  { label: 'Every hour', value: '0 * * * *' },
  { label: 'Every 6 hours', value: '0 */6 * * *' },
  { label: 'Every 12 hours', value: '0 */12 * * *' },
  { label: 'Once a day (9am)', value: '0 9 * * *' },
  { label: 'Twice a day', value: '0 9,18 * * *' },
];

const IMG_BASE = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api').replace('/api', '');

export default function App() {
  const [topic, setTopic] = useState('');
  const [article, setArticle] = useState(null);
  const [slides, setSlides] = useState([]);
  const [caption, setCaption] = useState('');
  const [imageUrls, setImageUrls] = useState([]);
  const [imagePaths, setImagePaths] = useState([]);
  const [loading, setLoading] = useState({ news: false, generate: false, post: false, pipeline: false });
  const [error, setError] = useState(null);
  const [posted, setPosted] = useState(null);
  const [activeTab, setActiveTab] = useState('manual');
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [cronExpression, setCronExpression] = useState('0 9 * * *');

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  async function fetchStatus() {
    try { setSchedulerStatus(await getSchedulerStatus()); } catch {}
  }

  function setLoad(key, val) {
    setLoading((p) => ({ ...p, [key]: val }));
  }

  async function handleFetchNews() {
    if (!topic.trim()) return setError('Please enter a topic');
    setError(null);
    setArticle(null);
    setSlides([]);
    setImageUrls([]);
    setPosted(null);
    setLoad('news', true);
    try {
      const art = await fetchNews(topic);
      setArticle(art);
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
    try {
      await startScheduler(cronExpression);
      fetchStatus();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function handleStopScheduler() {
    try { await stopScheduler(); fetchStatus(); } catch (e) { setError(e.message); }
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <h1>📸 Carousel Story Automator</h1>
          <p>Fetch trending news → AI story → Post as Instagram carousel</p>
        </div>
      </header>

      <main className="main">
        <section className="card config-card">
          <h2>Topic</h2>
          <div className="config-row">
            <div className="field">
              <label>What's the story about?</label>
              <input
                type="text"
                placeholder="e.g. AI, Bitcoin, Climate, Cricket..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleFetchNews()}
              />
            </div>
          </div>
        </section>

        <div className="tabs">
          <button className={activeTab === 'manual' ? 'tab active' : 'tab'} onClick={() => setActiveTab('manual')}>
            Manual Mode
          </button>
          <button className={activeTab === 'auto' ? 'tab active' : 'tab'} onClick={() => setActiveTab('auto')}>
            Auto Scheduler
          </button>
        </div>

        {error && <div className="error-banner">⚠️ {error}</div>}

        {activeTab === 'manual' && (
          <section className="card">
            <h2>Manual Pipeline</h2>
            <div className="button-row">
              <button className="btn btn-primary" onClick={handleFetchNews} disabled={loading.news}>
                {loading.news ? 'Fetching...' : '🔍 Fetch News'}
              </button>
              <button className="btn btn-secondary" onClick={handleGenerate} disabled={!article || loading.generate}>
                {loading.generate ? 'Generating...' : '✨ Generate Carousel'}
              </button>
              <button className="btn btn-danger" onClick={handleRunPipeline} disabled={loading.pipeline}>
                {loading.pipeline ? 'Running...' : '⚡ Auto Run'}
              </button>
            </div>

            {article && (
              <div className="article-card">
                <div className="article-meta">
                  <span className="source-badge">{article.source}</span>
                  {article.pubDate && <span className="pub-date">{new Date(article.pubDate).toLocaleDateString()}</span>}
                </div>
                <h3 className="article-title">{article.title}</h3>
                <p className="article-preview">{article.fullText.slice(0, 200)}...</p>
                <a href={article.url} target="_blank" rel="noreferrer" className="article-link">
                  Read full article →
                </a>
              </div>
            )}

            {slides.length > 0 && (
              <div className="carousel-preview">
                <h3>Carousel Preview ({slides.length} slides)</h3>
                <div className="slides-grid">
                  {slides.map((slide, i) => (
                    <div key={i} className="slide-card">
                      {imageUrls[i] && (
                        <img
                          src={`${IMG_BASE}${imageUrls[i]}`}
                          alt={`Slide ${i + 1}`}
                          className="slide-img"
                        />
                      )}
                      <div className="slide-info">
                        <span className="slide-type">{slide.type}</span>
                        <p className="slide-headline">{slide.headline}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="caption-section">
                  <label>Instagram Caption (editable)</label>
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    rows={6}
                  />
                </div>

                {posted ? (
                  <div className="posted-success">
                    ✅ Carousel posted! Instagram Post ID: <strong>{posted}</strong>
                  </div>
                ) : (
                  <button className="btn btn-instagram btn-full" onClick={handlePost} disabled={loading.post}>
                    {loading.post ? 'Posting carousel...' : '📸 Post Carousel to Instagram'}
                  </button>
                )}
              </div>
            )}
          </section>
        )}

        {activeTab === 'auto' && (
          <section className="card">
            <h2>Auto Scheduler</h2>
            <p className="help-text">
              Fully automated — picks the most viral AI news, generates a carousel, and posts to Instagram.
              No input needed. Topics rotate automatically across OpenAI, Anthropic, AI layoffs, model releases, and more.
            </p>

            <div className="field" style={{ marginBottom: '1rem' }}>
              <label>How often to post</label>
              <select value={cronExpression} onChange={(e) => setCronExpression(e.target.value)}>
                {CRON_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="scheduler-actions">
              <button className="btn btn-primary" onClick={handleStartScheduler} disabled={schedulerStatus?.running}>
                ▶ Start Posting
              </button>
              <button className="btn btn-danger" onClick={handleStopScheduler} disabled={!schedulerStatus?.running}>
                ⏹ Stop
              </button>
              <button className="btn btn-secondary" onClick={handleRunPipeline} disabled={loading.pipeline}>
                {loading.pipeline ? 'Posting...' : '⚡ Post One Now'}
              </button>
            </div>

            {schedulerStatus && (
              <div className={`status-box ${schedulerStatus.running ? 'status-active' : ''}`}>
                <div className="status-row">
                  <span>Status</span>
                  <strong>{schedulerStatus.running ? '🟢 Running' : '🔴 Stopped'}</strong>
                </div>
                {schedulerStatus.schedule && (
                  <div className="status-row">
                    <span>Schedule</span>
                    <strong>{CRON_PRESETS.find(p => p.value === schedulerStatus.schedule)?.label || schedulerStatus.schedule}</strong>
                  </div>
                )}
                {schedulerStatus.nextTopic && (
                  <div className="status-row">
                    <span>Next topic</span>
                    <strong>{schedulerStatus.nextTopic}</strong>
                  </div>
                )}
                {schedulerStatus.lastRun && (
                  <div className="status-row">
                    <span>Last run</span>
                    <strong>{new Date(schedulerStatus.lastRun).toLocaleString()}</strong>
                  </div>
                )}
                {schedulerStatus.totalPosted > 0 && (
                  <div className="status-row">
                    <span>Total posted</span>
                    <strong>{schedulerStatus.totalPosted} carousels</strong>
                  </div>
                )}
                {schedulerStatus.lastResult && (
                  <div className="status-row">
                    <span>Last post</span>
                    <strong>
                      {schedulerStatus.lastResult.success
                        ? `✅ "${schedulerStatus.lastResult.article?.slice(0, 50)}..."`
                        : `❌ ${schedulerStatus.lastResult.error}`}
                    </strong>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
