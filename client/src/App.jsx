import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const DIMENSION_META = [
  { key: 'subject', title: '核心主体与内容', weight: true },
  { key: 'style', title: '艺术风格与参考', weight: true },
  { key: 'lens', title: '镜头与构图', weight: false },
  { key: 'lighting', title: '光影与氛围', weight: false },
  { key: 'color', title: '色彩与质感', weight: false },
  { key: 'negative', title: '负面要素识别', weight: false },
];

const TARGET_OPTIONS = [
  { value: 'midjourney', label: 'Midjourney' },
  { value: 'stable-diffusion', label: 'Stable Diffusion 通用版' },
];

/** 悬停气泡（?）内短说明 */
const WEIGHT_TOOLTIP_TEXT =
  '数字越大，这一段在最终 Prompt 里越重要；越小越弱。默认 1。切换 Midjourney / SD 时，会自动用对应写法。';

const WEIGHT_INLINE_HINT = {
  subject: '调高：主体、场景更抢眼。',
  style: '调高：画风更抢眼。',
};

function Toast({ message, type, onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);
  const bg = type === 'error' ? 'var(--warning)' : 'var(--text)';
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        background: bg,
        color: '#fff',
        padding: '12px 20px',
        borderRadius: 'var(--radius)',
        boxShadow: 'var(--shadow)',
        zIndex: 1000,
        fontSize: 14,
        maxWidth: '90vw',
      }}
    >
      {message}
    </div>
  );
}

function useDebouncedCallback(fn, delay) {
  const ref = useRef();
  return useCallback(
    (...args) => {
      clearTimeout(ref.current);
      ref.current = setTimeout(() => fn(...args), delay);
    },
    [fn, delay]
  );
}

export default function App() {
  const [phase, setPhase] = useState('home');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [imageUrl, setImageUrl] = useState('');
  const [dimensions, setDimensions] = useState({});
  const [snapshot, setSnapshot] = useState({});
  const [basePrompts, setBasePrompts] = useState(null);
  const [livePrompts, setLivePrompts] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [targetModel, setTargetModel] = useState('midjourney');
  const [subjectWeight, setSubjectWeight] = useState(1);
  const [styleWeight, setStyleWeight] = useState(1);
  const [toast, setToast] = useState(null);
  const [visionSource, setVisionSource] = useState('');
  const [copyState, setCopyState] = useState({ main: false, neg: false });
  const [rebuilding, setRebuilding] = useState(false);
  const fileInputRef = useRef(null);

  const visibleDims = useMemo(
    () => DIMENSION_META.filter((d) => (dimensions[d.key] || '').trim().length > 0),
    [dimensions]
  );

  const dimsToRender = editMode ? DIMENSION_META : visibleDims;

  const displayedPrompts = useMemo(() => {
    if (!basePrompts) return null;
    if (dirty) {
      if (livePrompts) return livePrompts;
      return null;
    }
    return targetModel === 'midjourney' ? basePrompts.midjourney : basePrompts.stableDiffusion;
  }, [basePrompts, dirty, livePrompts, targetModel]);

  const rebuild = useCallback(async () => {
    if (!basePrompts) return;
    setRebuilding(true);
    try {
      const res = await fetch('/api/prompts/rebuild', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dimensions,
          targetModel,
          subjectWeight,
          styleWeight,
        }),
      });
      if (!res.ok) throw new Error('重建失败');
      const data = await res.json();
      setLivePrompts(data.prompts);
    } catch (e) {
      setToast({ message: e.message || '网络错误', type: 'error' });
    } finally {
      setRebuilding(false);
    }
  }, [basePrompts, dimensions, targetModel, subjectWeight, styleWeight]);

  const debouncedRebuild = useDebouncedCallback(rebuild, 320);

  useEffect(() => {
    if (dirty && basePrompts) debouncedRebuild();
  }, [dimensions, targetModel, subjectWeight, styleWeight, dirty, basePrompts, debouncedRebuild]);

  const showToast = (message, type = 'ok') => setToast({ message, type });

  const resetAll = () => {
    setDimensions({ ...snapshot });
    setSubjectWeight(1);
    setStyleWeight(1);
    setDirty(false);
    setLivePrompts(null);
    setRebuilding(false);
    showToast('已恢复为原始解析结果');
  };

  const onDrop = async (e) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files?.length) return;
    if (files.length > 1) showToast('仅支持单张图片处理，已自动使用第一张', 'ok');
    await processFile(files[0]);
  };

  const onPick = async (e) => {
    const files = e.target.files;
    if (!files?.length) return;
    if (files.length > 1) showToast('仅支持单张图片处理，已自动使用第一张', 'ok');
    await processFile(files[0]);
    e.target.value = '';
  };

  const processFile = async (file) => {
    const okTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!okTypes.includes(file.type)) {
      showToast('请上传 JPG/PNG/WEBP 格式，且大小≤10MB 的图片', 'error');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      showToast('请上传 JPG/PNG/WEBP 格式，且大小≤10MB 的图片', 'error');
      return;
    }

    setBusy(true);
    setProgress(0);
    setPhase('processing');
    const timer = setInterval(() => {
      setProgress((p) => (p >= 92 ? 92 : p + 6));
    }, 280);

    const fd = new FormData();
    fd.append('image', file);

    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || '解析失败');
      }
      clearInterval(timer);
      setProgress(100);
      setImageUrl(data.imageUrl);
      setDimensions(data.dimensions);
      setSnapshot({ ...data.dimensions });
      setBasePrompts(data.prompts);
      setLivePrompts(null);
      setDirty(false);
      setEditMode(false);
      setTargetModel(data.defaultTarget || 'midjourney');
      setSubjectWeight(1);
      setStyleWeight(1);
      setVisionSource(data.visionSource || '');
      setPhase('result');
    } catch (err) {
      clearInterval(timer);
      showToast(err.message || '处理失败', 'error');
      setPhase('home');
    } finally {
      setBusy(false);
      setTimeout(() => setProgress(0), 400);
    }
  };

  const copyText = async (text, kind) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState((s) => ({ ...s, [kind]: true }));
      setTimeout(() => setCopyState((s) => ({ ...s, [kind]: false })), 2000);
    } catch {
      showToast('复制失败，请手动选择文本', 'error');
    }
  };

  const updateDim = (key, value) => {
    setDimensions((d) => ({ ...d, [key]: value }));
    setDirty(true);
  };

  const goHome = () => {
    setPhase('home');
    setImageUrl('');
    setDimensions({});
    setBasePrompts(null);
    setLivePrompts(null);
    setDirty(false);
    setEditMode(false);
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          background: 'var(--bg)',
          borderBottom: '1px solid #e5e6eb',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, var(--primary), #6aa1ff)',
            }}
          />
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>Prompt Reverse Engine</div>
            <div style={{ fontSize: 12, color: 'var(--text-3)' }}>AI 绘画提示词反向生成 · MVP</div>
          </div>
        </div>
        {phase === 'result' && (
          <button
            type="button"
            onClick={goHome}
            style={{
              background: '#fff',
              border: '1px solid var(--primary)',
              color: 'var(--primary)',
              padding: '8px 16px',
              borderRadius: 'var(--radius)',
              fontWeight: 600,
            }}
          >
            上传新图片
          </button>
        )}
      </header>

      <main style={{ flex: 1, padding: '24px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        {phase === 'home' && (
          <section>
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              style={{
                border: '2px dashed #c9cdd4',
                borderRadius: 12,
                padding: '48px 24px',
                textAlign: 'center',
                background: 'var(--bg)',
                boxShadow: 'var(--shadow)',
              }}
            >
              <p style={{ color: 'var(--text-2)', marginBottom: 16 }}>
                拖拽图片到这里，或点击上传（支持 JPG/PNG/WEBP，单张≤10MB）
              </p>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy}
                style={{
                  background: 'var(--primary)',
                  color: '#fff',
                  border: 'none',
                  padding: '12px 28px',
                  borderRadius: 'var(--radius)',
                  fontWeight: 700,
                  fontSize: 15,
                }}
              >
                点击上传
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={onPick}
              />
            </div>
            <p style={{ color: 'var(--text-3)', fontSize: 13, marginTop: 20, lineHeight: 1.6 }}>
              本工具仅用于学习交流，请勿用于侵权用途。解析结果由多模态模型生成，仅供参考。
            </p>
          </section>
        )}

        {phase === 'processing' && (
          <section style={{ background: 'var(--bg)', padding: 32, borderRadius: 12, boxShadow: 'var(--shadow)' }}>
            <p style={{ marginBottom: 12, fontWeight: 600 }}>正在优化图片并解析中，请稍候…</p>
            <div style={{ height: 8, background: '#e5e6eb', borderRadius: 4, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progress}%`,
                  background: 'var(--primary)',
                  transition: 'width 0.25s ease',
                }}
              />
            </div>
          </section>
        )}

        {phase === 'result' && basePrompts && (
          <section style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div
              className="pre-result-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(260px, 1fr) minmax(320px, 1.2fr)',
                gap: 24,
                alignItems: 'start',
              }}
            >
              <div
                style={{
                  position: 'sticky',
                  top: 16,
                  background: 'var(--bg)',
                  padding: 16,
                  borderRadius: 12,
                  boxShadow: 'var(--shadow)',
                }}
              >
                <div style={{ fontWeight: 700, marginBottom: 12 }}>原图预览</div>
                <img
                  src={imageUrl}
                  alt="upload"
                  style={{ width: '100%', borderRadius: 8, display: 'block' }}
                />
                {visionSource && (
                  <p style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 10 }}>
                    解析模式：
                    {visionSource === 'demo' && '演示数据（未配置 API）'}
                    {visionSource === 'qianfan' && '百度千帆 Coding（OpenAI 兼容协议）'}
                    {visionSource === 'openai' && '多模态 API（OpenAI 兼容协议）'}
                  </p>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <span style={{ fontWeight: 700 }}>结构化解析</span>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--text-2)' }}>
                    <input
                      type="checkbox"
                      checked={editMode}
                      onChange={(e) => setEditMode(e.target.checked)}
                    />
                    编辑模式
                  </label>
                </div>

                {dimsToRender.map((dm) => (
                  <div
                    key={dm.key}
                    style={{
                      background: 'var(--bg)',
                      padding: 16,
                      borderRadius: 12,
                      boxShadow: 'var(--shadow)',
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 8 }}>{dm.title}</div>
                    {editMode ? (
                      <>
                        <textarea
                          value={dimensions[dm.key] || ''}
                          onChange={(e) => updateDim(dm.key, e.target.value)}
                          rows={dm.key === 'negative' ? 4 : 3}
                          style={{
                            width: '100%',
                            border: '1px solid #e5e6eb',
                            borderRadius: 8,
                            padding: 10,
                            resize: 'vertical',
                          }}
                        />
                        {dm.weight && (
                          <div style={{ marginTop: 12 }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                                marginBottom: 8,
                              }}
                            >
                              <span style={{ fontSize: 13, color: 'var(--text-2)', fontWeight: 500 }}>
                                权重
                              </span>
                              <span className="weight-help-anchor">
                                <button
                                  type="button"
                                  className="weight-help-btn"
                                  aria-label={WEIGHT_TOOLTIP_TEXT}
                                >
                                  ?
                                </button>
                                <span
                                  role="tooltip"
                                  className="weight-help-bubble"
                                >
                                  {WEIGHT_TOOLTIP_TEXT}
                                </span>
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                              <input
                                type="range"
                                min={0.5}
                                max={2}
                                step={0.1}
                                value={dm.key === 'subject' ? subjectWeight : styleWeight}
                                onChange={(e) => {
                                  const v = parseFloat(e.target.value);
                                  if (dm.key === 'subject') setSubjectWeight(v);
                                  else setStyleWeight(v);
                                  setDirty(true);
                                }}
                                style={{ flex: 1, minWidth: 0 }}
                                aria-describedby={`weight-hint-${dm.key}`}
                              />
                              <span
                                style={{
                                  fontSize: 13,
                                  color: 'var(--primary)',
                                  fontWeight: 600,
                                  minWidth: 28,
                                  textAlign: 'right',
                                }}
                              >
                                {(dm.key === 'subject' ? subjectWeight : styleWeight).toFixed(1)}
                              </span>
                            </div>
                            <p
                              id={`weight-hint-${dm.key}`}
                              style={{
                                margin: '8px 0 0',
                                fontSize: 12,
                                color: 'var(--text-3)',
                                lineHeight: 1.55,
                              }}
                            >
                              {WEIGHT_INLINE_HINT[dm.key]}
                            </p>
                          </div>
                        )}
                      </>
                    ) : (
                      <p style={{ margin: 0, lineHeight: 1.65, color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
                        {dimensions[dm.key]}
                      </p>
                    )}
                  </div>
                ))}

                {editMode && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={resetAll}
                      style={{
                        background: '#fff',
                        border: '1px solid var(--primary)',
                        color: 'var(--primary)',
                        padding: '8px 16px',
                        borderRadius: 'var(--radius)',
                        fontWeight: 600,
                      }}
                    >
                      恢复原始
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div
              style={{
                background: 'var(--bg)',
                padding: 20,
                borderRadius: 12,
                boxShadow: 'var(--shadow)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                <span style={{ fontWeight: 700 }}>Prompt 生成区</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-2)', fontSize: 14 }}>目标模型</span>
                  <select
                    value={targetModel}
                    onChange={(e) => {
                      setTargetModel(e.target.value);
                      if (dirty) setLivePrompts(null);
                    }}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      border: '1px solid #e5e6eb',
                      minWidth: 200,
                    }}
                  >
                    {TARGET_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ marginBottom: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600 }}>主 Prompt</span>
                  <button
                    type="button"
                    disabled={!displayedPrompts}
                    onClick={() => displayedPrompts && copyText(displayedPrompts.mainPrompt, 'main')}
                    style={{
                      background: 'var(--primary)',
                      color: '#fff',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: 'var(--radius)',
                      fontWeight: 700,
                      transform: copyState.main ? 'scale(0.98)' : 'none',
                      transition: 'transform 0.15s',
                      opacity: displayedPrompts ? 1 : 0.5,
                    }}
                  >
                    {copyState.main ? '已复制' : '复制主 Prompt'}
                  </button>
                </div>
                <div
                  style={{
                    background: '#fff',
                    border: '1px solid #e5e6eb',
                    borderRadius: 8,
                    padding: 14,
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                    fontSize: 14,
                    color: displayedPrompts ? 'inherit' : 'var(--text-3)',
                  }}
                >
                  {!displayedPrompts && (dirty || rebuilding)
                    ? '正在根据编辑更新 Prompt…'
                    : displayedPrompts?.mainPrompt}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontWeight: 600, color: 'var(--text-2)' }}>负面 Prompt（可选，用于规避瑕疵）</span>
                  <button
                    type="button"
                    disabled={!displayedPrompts}
                    onClick={() => displayedPrompts && copyText(displayedPrompts.negativePrompt, 'neg')}
                    style={{
                      background: 'var(--primary)',
                      color: '#fff',
                      border: 'none',
                      padding: '8px 16px',
                      borderRadius: 'var(--radius)',
                      fontWeight: 700,
                      opacity: displayedPrompts ? 1 : 0.5,
                    }}
                  >
                    {copyState.neg ? '已复制' : '复制负面 Prompt'}
                  </button>
                </div>
                <div
                  style={{
                    background: 'var(--bg-sub)',
                    border: '1px solid #e5e6eb',
                    borderRadius: 8,
                    padding: 14,
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                    fontSize: 14,
                    color: 'var(--text-2)',
                  }}
                >
                  {!displayedPrompts && (dirty || rebuilding)
                    ? '…'
                    : displayedPrompts?.negativePrompt}
                </div>
              </div>
            </div>

            <div style={{ textAlign: 'center', paddingBottom: 24 }}>
              <button
                type="button"
                onClick={() => showToast('感谢反馈！后续将接入反馈渠道。')}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--primary)',
                  textDecoration: 'underline',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
              >
                解析不准确？反馈给我们
              </button>
            </div>
          </section>
        )}
      </main>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
