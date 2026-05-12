require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { cleanOldImages } = require('./services/imageComposer');
const { autoResume } = require('./services/scheduler');

const scrapeRoutes = require('./routes/scrape');
const generateRoutes = require('./routes/generate');
const instagramRoutes = require('./routes/instagram');
const schedulerRoutes = require('./routes/scheduler');

const app = express();
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.options('*', cors());
app.use(express.json());

// Serve generated slide images
app.use('/temp', express.static(path.join(__dirname, 'temp')));

app.use('/api/scrape', scrapeRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/scheduler', schedulerRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Clean old temp images every hour
setInterval(cleanOldImages, 60 * 60 * 1000);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  autoResume();
});
