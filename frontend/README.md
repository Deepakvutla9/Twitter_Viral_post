# Synthetic Minds — Frontend

React + Vite dashboard for the Synthetic Minds carousel generator.

## What It Does

- Enter a topic to fetch a trending news article
- Preview the 2-slide carousel (photo hook + context slide)
- Post directly to Instagram or let the scheduler handle it automatically

## Stack

- React 19 + Vite
- Axios for API calls
- Deployed on Vercel

## Local Development

```bash
npm install
npm run dev    # http://localhost:5173
```

## Environment Variables

```env
VITE_API_URL=    # Backend URL — defaults to http://localhost:3001/api
```

Set `VITE_API_URL` to your Render backend URL in Vercel's environment settings for production.
