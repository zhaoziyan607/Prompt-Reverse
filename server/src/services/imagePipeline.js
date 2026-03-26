import sharp from 'sharp';

const MAX_EDGE = 2048;

/**
 * MVP preprocessing: normalize format, limit size, light sharpen for clarity.
 * Full watermark/OCR weakening can plug in here later.
 */
export async function preprocessImage(buffer) {
  const meta = await sharp(buffer).metadata();
  const w = meta.width || MAX_EDGE;
  const h = meta.height || MAX_EDGE;
  const needResize = w > MAX_EDGE || h > MAX_EDGE;

  let pipeline = sharp(buffer).rotate();

  if (needResize) {
    pipeline = pipeline.resize({
      width: MAX_EDGE,
      height: MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }

  const out = await pipeline
    .sharpen({ sigma: 0.8, m1: 1, m2: 2, x1: 2, y2: 10, y3: 20 })
    .webp({ quality: 90 })
    .toBuffer();

  return { buffer: out, mime: 'image/webp' };
}
