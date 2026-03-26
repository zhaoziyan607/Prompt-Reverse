/**
 * Midjourney vs SD prompt assembly from six dimensions + optional weights.
 * Weights: subjectWeight, styleWeight (0.5–2.0) — only used in client-driven regen via POST body;
 * server mirrors same rules for initial response.
 */

function mjWeightSegment(text, weight) {
  if (!text?.trim()) return '';
  const w = Number(weight);
  if (!Number.isFinite(w) || w === 1) return text.trim();
  return `${text.trim()}::${w.toFixed(1)}`;
}

function sdWeightSegment(text, weight) {
  if (!text?.trim()) return '';
  const w = Number(weight);
  if (!Number.isFinite(w) || w === 1) return `(${text.trim()})`;
  return `(${text.trim()}:${w.toFixed(2)})`;
}

export function buildPrompts(model, dimensions, weights = {}) {
  const d = dimensions;
  const subjectW = weights.subjectWeight ?? 1;
  const styleW = weights.styleWeight ?? 1;

  const parts = {
    subject: d.subject || '',
    style: d.style || '',
    lens: d.lens || '',
    lighting: d.lighting || '',
    color: d.color || '',
  };

  let main = '';
  let negative = (d.negative || '').trim();

  if (model === 'midjourney') {
    const segs = [
      mjWeightSegment(parts.subject, subjectW),
      mjWeightSegment(parts.style, styleW),
      parts.lens,
      parts.lighting,
      parts.color,
      'masterpiece, best quality, highly detailed, 8k uhd',
    ].filter(Boolean);
    main = segs.join(', ');
    if (negative) negative += ', ';
    negative += 'low quality, worst quality, blurry, deformed, extra limbs, text, watermark, logo';
  } else {
    const segs = [
      sdWeightSegment(parts.subject, subjectW),
      sdWeightSegment(parts.style, styleW),
      parts.lens,
      parts.lighting,
      parts.color,
      'masterpiece, best quality, highly detailed, sharp focus',
    ].filter(Boolean);
    main = segs.join(', ');
    if (negative) negative += ', ';
    negative += 'lowres, bad anatomy, bad hands, text, watermark, username, blurry';
  }

  return { mainPrompt: main.trim(), negativePrompt: negative.trim() };
}
