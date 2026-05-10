import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api' });

export const fetchNews = (topic, exclude = []) =>
  api.post('/scrape', { topic, exclude }).then((r) => r.data.article);

export const generateSlides = (article, topic) =>
  api.post('/generate', { article, topic }).then((r) => r.data);

export const postCarousel = (imagePaths, caption) =>
  api.post('/instagram/carousel', { imagePaths, caption }).then((r) => r.data);

export const runPipeline = () =>
  api.post('/scheduler/run').then((r) => r.data);

export const startScheduler = (cronExpression) =>
  api.post('/scheduler/start', { cronExpression }).then((r) => r.data);

export const stopScheduler = () =>
  api.post('/scheduler/stop').then((r) => r.data);

export const getSchedulerStatus = () =>
  api.get('/scheduler/status').then((r) => r.data);
