import { useState, useEffect } from 'react';
import {
  scrapeTweets,
  generatePosts,
  regenerateCaption,
  postToInstagram,
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

export default function App() {
  const [topic, setTopic] = useState('');
  const [count, setCount] = useState(5);
  const [tweets, setTweets] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState({ scrape: false, generate: false, pipeline: false });
  const [error, setError] = useState(null);
  const [posting, setPosting] = useState({});
  const [posted, setPosted] = useState({});
  const [schedulerStatus, setSchedulerStatus] = useState(null);
  const [cronExpression, setCronExpression] = useState('0 9 * * *');
  const [activeTab, setActiveTab] = useState('manual');

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 10000);
    return () => clearInterval(interval);
  }, []);

  async function fetchStatus() {
    try {
      const status = await getSchedulerStatus();
      setSchedulerStatus(status);
    } catch {}
  }

  function setLoad(key, val) {
    setLoading((prev) => ({ ...prev, [key]: val }));
  }

  async function handleScrape() {
    if (!topic.trim()) return setError('Please enter a topic');
    setError(null);
    setLoad('scrape', true);
    setPosts([]);
    setTweets([]);
    try {
      const result = await scrapeTweets(topic, count);
      setTweets(result);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('scrape', false);
    }
  }

  async function handleGenerate() {
    if (!tweets.length) return;
    setError(null);
    setLoad('generate', true);
    try {
      const result = await generatePosts(tweets, topic);
      setPosts(result);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('generate', false);
    }
  }

  async function handleRegenerate(index) {
    const tweet = posts[index].tweet;
    try {
      const caption = await regenerateCaption(tweet, topic);
      setPosts((prev) => {
        const updated = [...prev];
        updated[index] = { ...updated[index], caption };
        return updated;
      });
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function handlePost(index) {
    const { caption } = posts[index];
    setPosting((prev) => ({ ...prev, [index]: true }));
    try {
      const result = await postToInstagram(caption);
      setPosted((prev) => ({ ...prev, [index]: result.postId }));
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setPosting((prev) => ({ ...prev, [index]: false }));
    }
  }

  async function handleRunPipeline() {
    if (!topic.trim()) return setError('Please enter a topic');
    setError(null);
    setLoad('pipeline', true);
    try {
      const result = await runPipeline(topic, count);
      alert(`Pipeline complete! ${result.results.filter((r) => r.success).length} posts published.`);
      fetchStatus();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally {
      setLoad('pipeline', false);
    }
  }

  async function handleStartScheduler() {
    if (!topic.trim()) return setError('Please enter a topic');
    try {
      await startScheduler(cronExpression, topic, count);
      fetchStatus();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  async function handleStopScheduler() {
    try {
      await stopScheduler();
      fetchStatus();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    }
  }

  function updateCaption(index, value) {
    setPosts((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], caption: value };
      return updated;
    });
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header-inner">
          <h1>🚀 Viral Post Automator</h1>
          <p>Scrape trending X posts → AI rewrite → Auto-post to Instagram</p>
        </div>
      </header>

      <main className="main">
        <section className="card config-card">
          <h2>Configuration</h2>
          <div className="config-row">
            <div className="field">
              <label>Topic / Keyword</label>
              <input
                type="text"
                placeholder="e.g. AI, Bitcoin, Tesla, Cricket..."
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScrape()}
              />
            </div>
            <div className="field field-sm">
              <label>Number of posts</label>
              <input
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </div>
          </div>
        </section>

        <div className="tabs">
          <button
            className={activeTab === 'manual' ? 'tab active' : 'tab'}
            onClick={() => setActiveTab('manual')}
          >
            Manual Mode
          </button>
          <button
            className={activeTab === 'auto' ? 'tab active' : 'tab'}
            onClick={() => setActiveTab('auto')}
          >
            Auto Scheduler
          </button>
        </div>

        {error && <div className="error-banner">⚠️ {error}</div>}

        {activeTab === 'manual' && (
          <section className="card">
            <h2>Manual Pipeline</h2>
            <div className="button-row">
              <button className="btn btn-primary" onClick={handleScrape} disabled={loading.scrape}>
                {loading.scrape ? 'Scraping...' : '🔍 Scrape X Tweets'}
              </button>
              <button
                className="btn btn-secondary"
                onClick={handleGenerate}
                disabled={!tweets.length || loading.generate}
              >
                {loading.generate ? 'Generating...' : '✨ Generate IG Captions'}
              </button>
              <button
                className="btn btn-danger"
                onClick={handleRunPipeline}
                disabled={loading.pipeline}
              >
                {loading.pipeline ? 'Running...' : '⚡ Run Full Pipeline'}
              </button>
            </div>

            {tweets.length > 0 && posts.length === 0 && (
              <div className="tweets-section">
                <h3>Scraped Tweets ({tweets.length})</h3>
                <div className="tweet-list">
                  {tweets.map((t, i) => (
                    <div key={i} className="tweet-card">
                      <p className="tweet-text">{t.text}</p>
                      <div className="tweet-meta">
                        <span>@{t.username}</span>
                        <span>❤️ {t.likes}</span>
                        <span>🔁 {t.retweets}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {posts.length > 0 && (
              <div className="posts-section">
                <h3>Generated Instagram Posts ({posts.length})</h3>
                <div className="post-list">
                  {posts.map((p, i) => (
                    <div key={i} className="post-card">
                      <div className="post-source">
                        <span className="label">Source tweet:</span>
                        <p className="tweet-preview">{p.tweet.text}</p>
                      </div>
                      <div className="post-caption">
                        <label>Instagram Caption (editable)</label>
                        <textarea
                          value={p.caption}
                          onChange={(e) => updateCaption(i, e.target.value)}
                          rows={8}
                        />
                      </div>
                      <div className="post-actions">
                        <button className="btn btn-sm" onClick={() => handleRegenerate(i)}>
                          🔄 Regenerate
                        </button>
                        {posted[i] ? (
                          <span className="posted-badge">✅ Posted (ID: {posted[i]})</span>
                        ) : (
                          <button
                            className="btn btn-sm btn-instagram"
                            onClick={() => handlePost(i)}
                            disabled={posting[i]}
                          >
                            {posting[i] ? 'Posting...' : '📸 Post to Instagram'}
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        )}

        {activeTab === 'auto' && (
          <section className="card">
            <h2>Auto Scheduler</h2>
            <p className="help-text">
              Set a schedule and the app will automatically scrape, generate, and post to Instagram.
            </p>

            <div className="field">
              <label>Schedule Preset</label>
              <select value={cronExpression} onChange={(e) => setCronExpression(e.target.value)}>
                {CRON_PRESETS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label} ({p.value})
                  </option>
                ))}
              </select>
            </div>

            <div className="scheduler-actions">
              <button
                className="btn btn-primary"
                onClick={handleStartScheduler}
                disabled={schedulerStatus?.running}
              >
                ▶ Start Scheduler
              </button>
              <button
                className="btn btn-danger"
                onClick={handleStopScheduler}
                disabled={!schedulerStatus?.running}
              >
                ⏹ Stop Scheduler
              </button>
            </div>

            {schedulerStatus && (
              <div className={`status-box ${schedulerStatus.running ? 'status-active' : ''}`}>
                <div className="status-row">
                  <span>Status:</span>
                  <strong>{schedulerStatus.running ? '🟢 Running' : '🔴 Stopped'}</strong>
                </div>
                {schedulerStatus.topic && (
                  <div className="status-row">
                    <span>Topic:</span>
                    <strong>{schedulerStatus.topic}</strong>
                  </div>
                )}
                {schedulerStatus.schedule && (
                  <div className="status-row">
                    <span>Schedule:</span>
                    <strong>{schedulerStatus.schedule}</strong>
                  </div>
                )}
                {schedulerStatus.lastRun && (
                  <div className="status-row">
                    <span>Last run:</span>
                    <strong>{new Date(schedulerStatus.lastRun).toLocaleString()}</strong>
                  </div>
                )}
                {schedulerStatus.lastResult && (
                  <div className="status-row">
                    <span>Last result:</span>
                    <strong>
                      {Array.isArray(schedulerStatus.lastResult)
                        ? `${schedulerStatus.lastResult.filter((r) => r.success).length}/${schedulerStatus.lastResult.length} posted`
                        : JSON.stringify(schedulerStatus.lastResult)}
                    </strong>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        <section className="card setup-card">
          <h2>⚙️ Setup Checklist</h2>
          <div className="checklist">
            <div className="check-item">
              <span className="check-num">1</span>
              <div>
                <strong>Gemini API Key</strong>
                <p>
                  Get a free key at aistudio.google.com. Add to <code>backend/.env</code> as{' '}
                  <code>GEMINI_API_KEY</code>
                </p>
              </div>
            </div>
            <div className="check-item">
              <span className="check-num">2</span>
              <div>
                <strong>Instagram Graph API</strong>
                <p>
                  Convert Instagram to Business/Creator → Link to Facebook Page → Create Meta App →
                  Get long-lived token. Add <code>INSTAGRAM_ACCESS_TOKEN</code> &{' '}
                  <code>INSTAGRAM_USER_ID</code> to <code>backend/.env</code>
                </p>
              </div>
            </div>
            <div className="check-item">
              <span className="check-num">3</span>
              <div>
                <strong>Start backend</strong>
                <p>
                  Run <code>cd backend && npm start</code>
                </p>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
