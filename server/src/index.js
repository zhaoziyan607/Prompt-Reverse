import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '.env') });
import { optionalAuth } from './middleware/authPlaceholder.js';
import { insertUpload, insertAnalysis, purgeExpiredUploads } from './db.js';
import { preprocessImage } from './services/imagePipeline.js';
import { checkImageSafe } from './services/moderation.js';
import { analyzeDimensionsFromBuffer } from './services/visionAnalyze.js';
import { buildPrompts } from './services/promptEngine.js';

const uploadsRoot = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadsRoot)) fs.mkdirSync(uploadsRoot, { recursive: true });

const TTL_SEC = Number(process.env.UPLOAD_TTL_HOURS || 24) * 3600;
const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_SIZE = 10 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_SIZE },
});

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '2mb' }));
app.use(optionalAuth);

app.use('/api/uploads', express.static(uploadsRoot));

app.get('/api/health', (_req, res) => {
  const key = process.env.OPENAI_API_KEY;
  const base = process.env.OPENAI_BASE_URL || '';
  let visionMode = 'demo';
  if (key) {
    visionMode = base.includes('qianfan.baidubce.com') ? 'qianfan' : 'openai_compatible';
  }
  res.json({
    ok: true,
    visionMode,
    protocol: 'OpenAI Chat Completions compatible (POST /chat/completions)',
    baseUrlConfigured: Boolean(base),
  });
});

function validateFile(file) {
  if (!file) return '未收到文件';
  if (!ALLOWED.has(file.mimetype)) return '请上传 JPG/PNG/WEBP 格式，且大小≤10MB 的图片';
  return null;
}

app.post('/api/analyze', upload.single('image'), async (req, res) => {
  try {
    const file = req.file;
    const err = validateFile(file);
    if (err) return res.status(400).json({ error: 'validation', message: err });

    const safe = await checkImageSafe(file.buffer, file.mimetype);
    if (!safe.ok) {
      return res.status(422).json({
        error: 'moderation',
        message: '图片包含违规内容，请更换图片后重试',
      });
    }

    const { buffer: processed, mime } = await preprocessImage(file.buffer);
    const uploadId = uuidv4();
    const analysisId = uuidv4();
    const ext = '.webp';
    const storedName = `${uploadId}${ext}`;
    const storedPath = storedName;
    const fullPath = path.join(uploadsRoot, storedName);
    fs.writeFileSync(fullPath, processed);

    const now = Math.floor(Date.now() / 1000);
    const userId = req.user?.id ?? null;

    insertUpload({
      id: uploadId,
      user_id: userId,
      original_name: file.originalname || 'image',
      stored_path: storedPath,
      mime,
      size_bytes: processed.length,
      created_at: now,
      expires_at: now + TTL_SEC,
    });

    const { dimensions, source } = await analyzeDimensionsFromBuffer(processed, mime);
    insertAnalysis({
      id: analysisId,
      upload_id: uploadId,
      user_id: userId,
      dimensions_json: JSON.stringify(dimensions),
    });

    const mj = buildPrompts('midjourney', dimensions);
    const sd = buildPrompts('stable-diffusion', dimensions);

    const imageUrl = `/api/uploads/${storedName}`;

    return res.json({
      uploadId,
      analysisId,
      imageUrl,
      dimensions,
      prompts: {
        midjourney: mj,
        stableDiffusion: sd,
      },
      defaultTarget: 'midjourney',
      visionSource: source,
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({
      error: 'server',
      message: e.message || '处理失败，请稍后重试',
    });
  }
});

/** Client-side edited dimensions + weights → regenerated prompts without re-calling vision */
app.post('/api/prompts/rebuild', (req, res) => {
  try {
    const { dimensions, targetModel, subjectWeight, styleWeight } = req.body || {};
    if (!dimensions || typeof dimensions !== 'object') {
      return res.status(400).json({ error: 'validation', message: '缺少 dimensions' });
    }
    const model = targetModel === 'stable-diffusion' ? 'stable-diffusion' : 'midjourney';
    const w = {
      subjectWeight: Number(subjectWeight),
      styleWeight: Number(styleWeight),
    };
    const prompts = buildPrompts(model, dimensions, w);
    return res.json({ prompts });
  } catch (e) {
    return res.status(500).json({ error: 'server', message: e.message });
  }
});

/** 生产环境：托管 Vite 构建产物，浏览器与 API 同域，无需改前端请求路径 */
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

setInterval(() => {
  try {
    const n = purgeExpiredUploads(uploadsRoot);
    if (n > 0) console.log(`[cleanup] removed ${n} expired upload(s)`);
  } catch (e) {
    console.error('[cleanup]', e);
  }
}, 60 * 60 * 1000);

const PORT = Number(process.env.PORT || 8787);
app.listen(PORT, () => {
  const hasUi = fs.existsSync(clientDist);
  console.log(
    `PRE server http://localhost:${PORT}${hasUi ? ' (SPA + /api)' : ' (API only — run npm run build -w client for public UI)'}`
  );
});
