/**
 * In-memory post queue with file persistence.
 * Each entry: { id, title, imagePaths, caption, scheduledAt (ISO), status: 'pending'|'posted'|'failed', createdAt }
 */
const fs   = require('fs');
const path = require('path');

const QUEUE_FILE = path.join(__dirname, '../data/queue.json');

// Ensure data dir exists
const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function load() {
  try {
    if (fs.existsSync(QUEUE_FILE)) return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf8'));
  } catch {}
  return [];
}

function save(queue) {
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

let queue = load();

function getAll() {
  return queue;
}

function add(entry) {
  const item = { ...entry, id: Date.now().toString(), createdAt: new Date().toISOString(), status: 'pending' };
  queue.push(item);
  save(queue);
  return item;
}

function remove(id) {
  queue = queue.filter(e => e.id !== id);
  save(queue);
}

function updateStatus(id, status, error = null) {
  const item = queue.find(e => e.id === id);
  if (item) {
    item.status = status;
    if (error) item.error = error;
    save(queue);
  }
}

function getPending() {
  const now = new Date();
  return queue.filter(e => e.status === 'pending' && new Date(e.scheduledAt) <= now);
}

module.exports = { getAll, add, remove, updateStatus, getPending };
