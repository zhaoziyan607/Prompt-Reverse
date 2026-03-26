/**
 * Content safety: plug in cloud moderation (e.g. Aliyun, Tencent, OpenAI moderation) here.
 * MVP returns { ok: true } unless MOCK_MODERATION_FAIL=1 (dev testing).
 */
export async function checkImageSafe(_buffer, _mime) {
  if (process.env.MOCK_MODERATION_FAIL === '1') {
    return { ok: false, reason: 'mock_flagged' };
  }
  return { ok: true };
}
