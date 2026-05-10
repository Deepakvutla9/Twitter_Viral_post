require('dotenv').config();
const express = require('express');
const cors = require('cors');

const scrapeRoutes = require('./routes/scrape');
const generateRoutes = require('./routes/generate');
const instagramRoutes = require('./routes/instagram');
const schedulerRoutes = require('./routes/scheduler');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/scrape', scrapeRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/scheduler', schedulerRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
