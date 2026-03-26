import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, '..', 'data');
const storePath = path.join(dataDir, 'store.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

function loadStore() {
  if (!fs.existsSync(storePath)) {
    return { uploads: [], analyses: [], users: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(storePath, 'utf8'));
  } catch {
    return { uploads: [], analyses: [], users: [] };
  }
}

function saveStore(data) {
  fs.writeFileSync(storePath, JSON.stringify(data, null, 2), 'utf8');
}

export function insertUpload(row) {
  const s = loadStore();
  s.uploads.push(row);
  saveStore(s);
}

export function insertAnalysis(row) {
  const s = loadStore();
  s.analyses.push(row);
  saveStore(s);
}

export function getUploadById(id) {
  const s = loadStore();
  return s.uploads.find((u) => u.id === id);
}

export function purgeExpiredUploads(uploadsRoot) {
  const now = Math.floor(Date.now() / 1000);
  const s = loadStore();
  const before = s.uploads.length;
  const keep = [];
  let removed = 0;
  for (const u of s.uploads) {
    if (u.expires_at < now) {
      try {
        const full = path.join(uploadsRoot, u.stored_path);
        if (fs.existsSync(full)) fs.unlinkSync(full);
      } catch {
        /* ignore */
      }
      removed++;
    } else {
      keep.push(u);
    }
  }
  s.uploads = keep;
  if (removed) {
    s.analyses = s.analyses.filter((a) => keep.some((u) => u.id === a.upload_id));
    saveStore(s);
  }
  return before - keep.length;
}
