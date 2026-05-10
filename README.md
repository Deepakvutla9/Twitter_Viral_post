# 🚀 Viral Post Automator

Automatically scrape trending content from Reddit, rewrite it into viral Instagram captions using Gemini AI, and post directly to your Instagram — fully automated on a schedule.

---

## Features

- **Trending Content Scraping** — Fetches the most-commented Reddit posts on any topic using Reddit's free public API (no login required)
- **AI Caption Generation** — Rewrites posts into engaging Instagram captions with hooks, emojis, and hashtags using Google Gemini AI
- **Instagram Auto-Posting** — Posts directly to your Instagram Business/Creator account via the Instagram Graph API
- **Manual Mode** — Scrape → preview → edit → post individual captions with full control
- **Auto Scheduler** — Set a cron schedule (hourly, daily, twice a day, etc.) to run the full pipeline automatically
- **Editable Captions** — Edit any generated caption before posting
- **Regenerate** — Re-generate a caption for any post with one click
- **Real-time Scheduler Status** — Live dashboard showing scheduler state, last run time, and results

---

## Architecture

```
Twitter_Viral_post/
├── backend/                        # Node.js + Express API server
│   ├── server.js                   # Entry point, route registration
│   ├── .env                        # API keys and credentials (git-ignored)
│   ├── services/
│   │   ├── xScraper.js             # Reddit scraper (most-commented posts)
│   │   ├── gemini.js               # Gemini AI caption generator
│   │   ├── instagram.js            # Instagram Graph API posting service
│   │   └── scheduler.js           # node-cron automation engine
│   └── routes/
│       ├── scrape.js               # POST /api/scrape
│       ├── generate.js             # POST /api/generate, /api/generate/single
│       ├── instagram.js            # POST /api/instagram/post
│       └── scheduler.js           # GET/POST /api/scheduler/*
│
└── frontend/                       # React + Vite dashboard
    └── src/
        ├── App.jsx                 # Main dashboard UI
        ├── App.css                 # Dark theme styles
        └── api.js                  # Axios API client
```

---

## Flow

```
User enters topic
       │
       ▼
[Reddit API] ──► Fetch most-commented posts on topic
       │
       ▼
[Gemini AI] ──► Rewrite each post as an Instagram caption
       │         (hook + body + emojis + hashtags)
       ▼
[Preview UI] ──► User can edit or regenerate any caption
       │
       ▼
[Instagram Graph API] ──► Post to @shadesofirony
       │
       ▼
[node-cron] ──► Repeat automatically on schedule
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite |
| Backend | Node.js + Express 5 |
| Content Source | Reddit Public API |
| AI | Google Gemini 2.0 Flash |
| Instagram Posting | Instagram Graph API (v19) |
| Scheduling | node-cron |
| HTTP Client | Axios |

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/Deepakvutla9/Twitter_Viral_post.git
cd Twitter_Viral_post
```

### 2. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 3. Configure environment variables

Create `backend/.env`:

```env
GEMINI_API_KEY=your_gemini_api_key
INSTAGRAM_ACCESS_TOKEN=your_instagram_access_token
INSTAGRAM_USER_ID=your_instagram_user_id
PORT=3001
```

| Variable | Where to get it |
|---|---|
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) → API Keys (free) |
| `INSTAGRAM_ACCESS_TOKEN` | Meta Developer → ViralPoster app → Instagram → Generate token |
| `INSTAGRAM_USER_ID` | Returned from `graph.instagram.com/me` using your token |

> **Instagram requirement:** Your account must be a Business or Creator account. Generate the token via the Instagram API setup with Instagram login flow in Meta Developer dashboard.

### 4. Run the app

**Terminal 1 — Backend:**
```bash
cd backend
node server.js
```

**Terminal 2 — Frontend:**
```bash
cd frontend
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/scrape` | Scrape Reddit posts for a topic |
| `POST` | `/api/generate` | Generate IG captions for scraped posts |
| `POST` | `/api/generate/single` | Regenerate caption for one post |
| `POST` | `/api/instagram/post` | Post a caption to Instagram |
| `POST` | `/api/scheduler/run` | Run the full pipeline once manually |
| `POST` | `/api/scheduler/start` | Start the auto scheduler |
| `POST` | `/api/scheduler/stop` | Stop the auto scheduler |
| `GET` | `/api/scheduler/status` | Get current scheduler status |

---

## Usage

### Manual Mode
1. Enter a topic (e.g. "F1 Visa", "AI", "Bitcoin")
2. Set number of posts (1–20)
3. Click **Scrape X Tweets** → fetches top Reddit posts
4. Click **Generate IG Captions** → AI rewrites them
5. Edit any caption if needed
6. Click **Post to Instagram** on each post

### Auto Scheduler
1. Enter topic and post count
2. Switch to **Auto Scheduler** tab
3. Choose a schedule (hourly, daily, etc.)
4. Click **Start Scheduler** — runs fully automatically

### Run Full Pipeline
Click **Run Full Pipeline** to scrape + generate + post in one click without reviewing.

---

## Notes

- Reddit API is free with no authentication required
- Gemini free tier allows ~1500 requests/day — sufficient for automated daily posting
- Instagram Graph API is free; requires a Business/Creator Instagram account
- The `.env` file is git-ignored — never commit credentials
