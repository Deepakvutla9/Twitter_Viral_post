import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api' });

export const fetchNews = (topic, exclude = []) =>
  api.post('/scrape', { topic, exclude }).then((r) => r.data.article);

export const generateCustomSlides = (title, body, imageFile) => {
  const form = new FormData();
  form.append('title', title);
  form.append('body', body);
  if (imageFile) form.append('image', imageFile);
  return api.post('/generate-custom', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data);
};

export const generateSlides = (article, topic) =>
  api.post('/generate', { article, topic }).then((r) => r.data);

export const postCarousel = (imagePaths, caption, articleUrl) =>
  api.post('/instagram/carousel', { imagePaths, caption, articleUrl }).then((r) => r.data);

export const runPipeline = () =>
  api.post('/scheduler/run').then((r) => r.data);

export const getQueue    = ()             => api.get('/queue').then((r) => r.data);
export const addToQueue  = (payload)      => api.post('/queue', payload).then((r) => r.data);
export const removeFromQueue = (id)       => api.delete(`/queue/${id}`).then((r) => r.data);

export const startScheduler = (cronExpression) =>
  api.post('/scheduler/start', { cronExpression }).then((r) => r.data);

export const stopScheduler = () =>
  api.post('/scheduler/stop').then((r) => r.data);

export const getSchedulerStatus = () =>
  api.get('/scheduler/status').then((r) => r.data);

export const getTrending = () =>
  api.get('/trending').then((r) => r.data.stories);
