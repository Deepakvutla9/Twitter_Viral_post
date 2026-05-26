# Synthetic Minds — Viral Carousel Generator

Automated Instagram carousel generator for the **Synthetic Minds** page (`@shadesofirony`). Scrapes trending tech news, generates 2-slide visual carousels using AI, and posts them automatically on a schedule.

---

## How It Works

1. **News Scraping** — Pulls trending articles from trusted tech sources (TechCrunch, The Verge, Wired, BBC, Bloomberg, Reuters, etc.) via RSS feeds and Hacker News trending
2. **AI Slide Generation** — Groq (Llama 3.3 70B) writes slide copy: badge tag, headline, and 5–6 sentence body with one key phrase highlighted in cyan
3. **Image Composition** — Sharp renders two 1080×1080 JPEG slides:
   - **Slide 1:** Article photo + full headline + dynamic badge pill
   - **Slide 2:** AI-generated background (Hugging Face FLUX.1) + body context, vertically centered
4. **Auto-Post** — Instagram Graph API posts the carousel with caption + hashtags on a cron schedule (default: every 6 hours)

---

## Architecture

```
Twitter_Viral_post/
├── backend/
│   ├── server.js                  # Express entry point
│   ├── .env                       # API keys (git-ignored)
│   ├── routes/
│   │   ├── generate.js            # POST /api/generate
│   │   ├── scrape.js              # POST /api/scrape
│   │   └── scheduler.js           # Scheduler routes
│   ├── services/
│   │   ├── gemini.js              # Groq LLM — slide copy generation
│   │   ├── imageComposer.js       # Sharp + SVG — 1080x1080 rendering
│   │   ├── newsScraper.js         # RSS + HN scraper (trusted domains only)
│   │   └── instagramPoster.js     # Instagram Graph API
│   └── temp/                      # Generated images (auto-cleaned hourly)
└── frontend/
    └── src/
        ├── App.jsx                # Dashboard UI
        └── api.js                 # Axios API client
```

---

## Slide Design

### Slide 1 — Hook
- Full article photo (vivid, top crop)
- Heavy bottom gradient overlay
- `SYNTHETIC MINDS` logo pill — top left
- Dynamic badge pill: `NEWS` / `BREAKING` / `AI UPDATE` / `EXCLUSIVE` / `ALERT`
- Full original article title as headline with cyan auto-highlights on key terms
- Adaptive font size (96 / 84 / 72px) based on title length — always fits

### Slide 2 — Context
- AI-generated background (FLUX.1-schnell) or dark-tinted article photo fallback
- 5–6 factual sentences, vertically centered on the slide
- One key phrase highlighted in cyan (`#00e5ff`)
- Text always trimmed to a complete sentence — never cuts mid-sentence
- Bottom bar: `@shadesofirony` left · `Follow for more →` right (cyan)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React + Vite (Vercel) |
| Backend | Node.js + Express (Render) |
| AI Copywriting | Groq — Llama 3.3 70B |
| Image Generation | Hugging Face — FLUX.1-schnell |
| Image Composition | Sharp + SVG |
| Scheduling | node-cron |
| Posting | Instagram Graph API |

---

## Setup

### 1. Clone

```bash
git clone https://github.com/Deepakvutla9/Twitter_Viral_post.git
cd Twitter_Viral_post
```

### 2. Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
```

### 3. Environment variables

Create `backend/.env`:

```env
GROQ_API_KEY=              # groq.com — free tier available
HF_API_KEY=                # huggingface.co — free tier (1500 req/day)
INSTAGRAM_ACCESS_TOKEN=    # Meta Developer — Instagram Graph API token
INSTAGRAM_ACCOUNT_ID=      # Your Instagram Business account ID
PORT=3001
```

### 4. Run locally

```bash
# Terminal 1
cd backend && node server.js      # http://localhost:3001

# Terminal 2
cd frontend && npm run dev        # http://localhost:5173
```

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/scrape` | Fetch trending article for a topic |
| `POST` | `/api/generate` | Generate slides + compose images |
| `POST` | `/api/instagram/carousel` | Post carousel to Instagram |
| `POST` | `/api/scheduler/run` | Run full pipeline once manually |
| `POST` | `/api/scheduler/start` | Start auto scheduler |
| `POST` | `/api/scheduler/stop` | Stop auto scheduler |
| `GET` | `/api/scheduler/status` | Get scheduler status |

---

## Deployment

- **Backend** → [Render](https://render.com) — auto-deploys from `main`
- **Frontend** → [Vercel](https://vercel.com) — auto-deploys from `main`

---

## Branding

| Element | Value |
|---|---|
| Page name | Synthetic Minds |
| Handle | @shadesofirony |
| Accent color | `#00e5ff` (cyan) |
| Slide size | 1080 × 1080 px |
| Font | Arial Black / Arial |
