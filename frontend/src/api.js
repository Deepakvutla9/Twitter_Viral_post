import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:3001/api' });

export const scrapeTweets = (topic, count) =>
  api.post('/scrape', { topic, count }).then((r) => r.data.tweets);

export const generatePosts = (tweets, topic) =>
  api.post('/generate', { tweets, topic }).then((r) => r.data.posts);

export const regenerateCaption = (tweet, topic) =>
  api.post('/generate/single', { tweet, topic }).then((r) => r.data.caption);

export const postToInstagram = (caption, imageUrl) =>
  api.post('/instagram/post', { caption, imageUrl }).then((r) => r.data);

export const runPipeline = (topic, count) =>
  api.post('/scheduler/run', { topic, count }).then((r) => r.data);

export const startScheduler = (cronExpression, topic, count) =>
  api.post('/scheduler/start', { cronExpression, topic, count }).then((r) => r.data);

export const stopScheduler = () =>
  api.post('/scheduler/stop').then((r) => r.data);

export const getSchedulerStatus = () =>
  api.get('/scheduler/status').then((r) => r.data);
