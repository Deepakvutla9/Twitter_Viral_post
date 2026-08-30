import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001/api' });

// The key is entered once and kept in this browser. It is not baked into the
// bundle: a key shipped in the build is a key published to anyone who loads the
// page, and this one can publish to Instagram.
const KEY_STORAGE = 'frontrun.apiKey';
const ACCOUNT_STORAGE = 'frontrun.account';

const readStored = (name) => {
  try {
    return window.localStorage.getItem(name) || '';
  } catch {
    return '';
  }
};
const writeStored = (name, value) => {
  try {
    if (value) window.localStorage.setItem(name, value);
    else window.localStorage.removeItem(name);
  } catch { /* private browsing: the session still works, it just will not persist */ }
};

export const getApiKey = () => readStored(KEY_STORAGE);
export const setApiKey = (key) => writeStored(KEY_STORAGE, key);
export const hasApiKey = () => Boolean(getApiKey());

export const getActiveAccount = () => readStored(ACCOUNT_STORAGE);
export const setActiveAccount = (slug) => writeStored(ACCOUNT_STORAGE, slug);

api.interceptors.request.use((config) => {
  const key = getApiKey();
  if (key) config.headers['x-api-key'] = key;
  return config;
});

// Every request that acts on an account carries the selected slug. Left off when
// nothing is selected, which the backend reads as the default account.
const withAccount = (payload = {}) => {
  const account = getActiveAccount();
  return account ? { ...payload, account } : payload;
};

// Turns an axios failure into something worth showing a person.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err.response?.status;
    const detail = err.response?.data?.error;
    if (status === 401) {
      return Promise.reject(new Error('That API key was not accepted. Check it and try again.'));
    }
    if (status === 503 && /API_KEY/.test(detail || '')) {
      return Promise.reject(new Error('The server has no API key configured, so these actions are closed.'));
    }
    if (status === 403 || status === 404) {
      return Promise.reject(new Error(detail || 'That account is not available.'));
    }
    return Promise.reject(new Error(detail || err.message));
  },
);

// Defensive because a malformed response used to blank the entire page: an
// unexpected shape here (a proxy error page, an old backend) must degrade to
// "no accounts to choose from", not take the UI down.
export const getAccounts = () => api.get('/accounts').then((r) => {
  const list = r?.data?.accounts;
  return Array.isArray(list) ? list : [];
});

// The management panel needs the accounts the selector deliberately hides: an
// account that is switched off is the one you need to see to switch it back on.
export const getAllAccounts = () => api.get('/accounts', { params: { all: 1 } }).then((r) => {
  const list = r?.data?.accounts;
  return Array.isArray(list) ? list : [];
});

export const setAccountActive = (slug, active) =>
  api.patch(`/accounts/${encodeURIComponent(slug)}`, { active }).then((r) => r.data.account);

export const fetchNews = (topic, exclude = []) =>
  api.post('/scrape', withAccount({ topic, exclude })).then((r) => r.data.article);

export const generateCustomSlides = (title, body, imageFile) => {
  const form = new FormData();
  form.append('title', title);
  form.append('body', body);
  const account = getActiveAccount();
  if (account) form.append('account', account);
  if (imageFile) form.append('image', imageFile);
  return api.post('/generate-custom', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then((r) => r.data);
};

export const generateSlides = (article, topic) =>
  api.post('/generate', withAccount({ article, topic })).then((r) => r.data);

export const postCarousel = (imagePaths, caption, articleUrl) =>
  api.post('/instagram/carousel', withAccount({ imagePaths, caption, articleUrl })).then((r) => r.data);

export const runPipeline = () =>
  api.post('/scheduler/run', withAccount()).then((r) => r.data);

export const getQueue    = ()             => api.get('/queue').then((r) => r.data);
export const addToQueue  = (payload)      => api.post('/queue', withAccount(payload)).then((r) => r.data);
export const removeFromQueue = (id)       => api.delete(`/queue/${id}`).then((r) => r.data);

export const startScheduler = (cronExpression) =>
  api.post('/scheduler/start', { cronExpression }).then((r) => r.data);

export const stopScheduler = () =>
  api.post('/scheduler/stop').then((r) => r.data);

export const getSchedulerStatus = () =>
  api.get('/scheduler/status').then((r) => r.data);

export const getTrending = () =>
  api.get('/trending').then((r) => r.data.stories);
