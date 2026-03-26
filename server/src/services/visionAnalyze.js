/**
 * 六维结构化解析：使用 **OpenAI Chat Completions 兼容协议**（POST .../chat/completions）。
 * 百度智能云千帆 Coding Plan：Base URL 通常为 https://qianfan.baidubce.com/v2/coding
 * （完整路径 = Base + /chat/completions）。鉴权：Authorization: Bearer <API Key>。
 *
 * 环境变量：
 * - OPENAI_API_KEY — 必填（含 bce-v3/... 形式的千帆 Key）
 * - OPENAI_BASE_URL — 默认 https://api.openai.com/v1；千帆 Coding 填 https://qianfan.baidubce.com/v2/coding
 * - VISION_MODEL — 默认 qianfan-code-latest（可按控制台路由修改）
 *
 * 说明：Anthropic 协议（/anthropic/coding）与本项目请求体不同，当前未使用。
 * 若 qianfan-code-latest 路由到的模型不支持图像，接口可能报错，请在控制台换为多模态模型或改用支持视觉的 endpoint。
 */

import sharp from 'sharp';

const DIMENSION_KEYS = [
  'subject',
  'style',
  'lens',
  'lighting',
  'color',
  'negative',
];

const SYSTEM_PARSE = `You are an expert at reverse-engineering images into AI art prompts.
Analyze the image and return ONLY valid JSON with these string fields (use empty string if not applicable):
subject: core subjects, actions, environment
style: art style, references, medium
lens: shot type, angle, composition
lighting: light source, mood
color: palette, materials, texture
negative: flaws to avoid in AI generation (watermark, blur, deformed limbs, etc.)
Write concise English suitable for Midjourney/Stable Diffusion.`;

function demoDimensions() {
  return {
    subject:
      'A lone figure in a long coat standing on a wet cyberpunk street at night, neon signs reflecting on puddles, tall buildings, light rain',
    style:
      'Cinematic digital art, blade-runner inspired cityscape, highly detailed, concept art',
    lens: 'Wide-angle street shot, low camera height, leading lines toward vanishing point, rule of thirds',
    lighting:
      'Moody cyan and magenta neon rim light, soft ambient fill, high contrast shadows, rainy atmosphere',
    color:
      'Teal and magenta palette, glossy wet asphalt, metallic surfaces, subtle film grain',
    negative:
      'low resolution, watermark, text overlay, extra fingers, deformed anatomy, cropped head, oversaturated noise',
  };
}

function normalizeBaseUrl(base) {
  return (base || '').replace(/\/+$/, '');
}

/** OpenAI SDK 风格：base 为 .../v1 或 .../v2/coding，路径统一为 /chat/completions */
function chatCompletionsUrl(base) {
  return `${normalizeBaseUrl(base)}/chat/completions`;
}

function isQianfanCodingBase(base) {
  return typeof base === 'string' && base.includes('qianfan.baidubce.com');
}

/** 千帆文档对 Base64 多写明 JPG/PNG/BMP；统一转成 JPEG 再调用，避免 WebP 被拒 */
async function bufferToJpegForVision(buffer) {
  return sharp(buffer).jpeg({ quality: 92 }).toBuffer();
}

function resolveVisionSource(baseUrl) {
  if (!baseUrl) return 'openai';
  if (isQianfanCodingBase(baseUrl)) return 'qianfan';
  return 'openai';
}

async function callOpenAICompatibleVision(imageBase64, mime, opts = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const model = process.env.VISION_MODEL || 'gpt-4o-mini';
  const maxOut = Number(process.env.VISION_MAX_TOKENS || 1200);

  const url = chatCompletionsUrl(base);

  const body = {
    model,
    temperature: 0.3,
    stream: false,
    messages: [
      { role: 'system', content: SYSTEM_PARSE },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Return only a JSON object with keys: subject, style, lens, lighting, color, negative.',
          },
          {
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${imageBase64}` },
          },
        ],
      },
    ],
  };

  if (opts.useMaxCompletionTokens) {
    body.max_completion_tokens = maxOut;
  } else {
    body.max_tokens = maxOut;
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const errText = await res.text();
  if (!res.ok) {
    let detail = errText.slice(0, 800);
    try {
      const parsedErr = JSON.parse(errText);
      const msg = parsedErr?.error?.message || parsedErr?.message;
      if (typeof msg === 'string' && msg.trim()) detail = msg.trim();
    } catch {
      // keep raw text fallback
    }

    const lc = detail.toLowerCase();
    if (
      lc.includes('image_url') &&
      (lc.includes('only supported') || lc.includes('invalid content type'))
    ) {
      throw new Error(
        '当前所选模型不支持图片输入。请在服务端改用支持多模态的模型与端点（例如千帆 v2 多模态模型），然后重试。'
      );
    }

    throw new Error(`Vision API ${res.status}: ${detail}`);
  }

  let data;
  try {
    data = JSON.parse(errText);
  } catch {
    throw new Error(`Vision API returned non-JSON: ${errText.slice(0, 200)}`);
  }

  const text = extractAssistantText(data);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Model did not return JSON object in the reply');
  const parsed = JSON.parse(jsonMatch[0]);
  return normalizeDimensions(parsed);
}

function extractAssistantText(data) {
  const msg = data?.choices?.[0]?.message;
  if (!msg) return '';
  const c = msg.content;
  if (typeof c === 'string') return c.trim();
  if (Array.isArray(c)) {
    return c
      .map((p) => (p?.type === 'text' ? p.text || '' : ''))
      .join('')
      .trim();
  }
  return '';
}

function normalizeDimensions(raw) {
  const out = {};
  for (const k of DIMENSION_KEYS) {
    const v = raw[k];
    out[k] = typeof v === 'string' ? v.trim() : v != null ? String(v).trim() : '';
  }
  return out;
}

export async function analyzeDimensionsFromBuffer(buffer, mime) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { dimensions: demoDimensions(), source: 'demo' };
  }

  const base = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  const source = resolveVisionSource(base);

  let visionBuffer = buffer;
  let visionMime = mime || 'image/jpeg';
  if (isQianfanCodingBase(base) || mime?.includes('webp')) {
    visionBuffer = await bufferToJpegForVision(buffer);
    visionMime = 'image/jpeg';
  }

  const b64 = visionBuffer.toString('base64');

  const useMaxCompletion =
    process.env.VISION_USE_MAX_COMPLETION_TOKENS === '1';

  const dimensions = await callOpenAICompatibleVision(b64, visionMime, {
    useMaxCompletionTokens: useMaxCompletion,
  });

  return { dimensions, source };
}

export { DIMENSION_KEYS };
