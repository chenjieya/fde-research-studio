/**
 * 创建空研究空间，页面加载时不再塞入模拟数据。
 * @returns {import('../types').Workspace}
 */
export function emptyWorkspace() {
  return { version: 1, models: [], experiments: [], notes: [], artifacts: [] };
}
export const domains = /** @type {const} */ (['图片', 'CAD', '视频', '语言文本']);
export const stages = /** @type {const} */ (['待调研', '研究中', '已验证', '持续跟踪']);
export const kinds = /** @type {const} */ ([
  '研究周报',
  '模型对比报告',
  'FDE 方案草稿',
  '技术调研简报',
]);
/**
 * 为新记录生成编号，前缀用来区分记录种类。
 * @param {string} prefix
 */
export function uid(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}
/** 返回本地日期，统一使用 YYYY-MM-DD 格式。 */
export function today() {
  return new Date().toLocaleDateString('sv-SE');
}
/**
 * 确认接口或备份中的值是对象且不是数组，便于继续检查字段。
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * 检查指定文本字段，避免异常类型和过大的内容进入页面。
 * @param {Record<string, unknown>} value
 * @param {string[]} keys
 */
function strings(value, keys) {
  return keys.every((key) => typeof value[key] === 'string' && value[key].length <= 200000);
}
/**
 * 只保留网页链接，阻止脚本地址进入来源链接。
 * @param {unknown} value
 */
export function safeUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}
/**
 * 逐条检查备份中的记录、编号和模型引用，确认后才允许恢复。
 * @param {unknown} value
 * @returns {value is import('../types').Workspace}
 */
export function isWorkspace(value) {
  if (!object(value) || value.version !== 1) return false;
  const listKeys = ['models', 'experiments', 'notes', 'artifacts'];
  if (!listKeys.every((key) => Array.isArray(value[key]) && value[key].length <= 10000))
    return false;
  const { models, experiments, notes, artifacts } = value;
  if (
    !Array.isArray(models) ||
    !Array.isArray(experiments) ||
    !Array.isArray(notes) ||
    !Array.isArray(artifacts)
  )
    return false;
  const unique = /** @param {unknown[]} rows */ (rows) =>
    rows.every(object) &&
    new Set(rows.map((row) => (object(row) ? row.id : null))).size === rows.length;
  if (![models, experiments, notes, artifacts].every(unique)) return false;
  const validModels = models.every(
    (m) =>
      object(m) &&
      strings(m, [
        'id',
        'name',
        'vendor',
        'summary',
        'route',
        'access',
        'license',
        'source',
        'updated',
        'notes',
      ]) &&
      m.id &&
      m.name &&
      domains.some((d) => d === m.domain) &&
      stages.some((s) => s === m.stage) &&
      Array.isArray(m.capabilities) &&
      m.capabilities.length > 0 &&
      m.capabilities.every((c) => c === '生成编辑' || c === '识别理解') &&
      typeof m.demo === 'boolean' &&
      typeof m.favorite === 'boolean' &&
      (!m.source || safeUrl(m.source)),
  );
  const modelIds = new Set(models.filter(object).map((m) => m.id));
  const validExperiments = experiments.every(
    (e) =>
      object(e) &&
      strings(e, [
        'id',
        'title',
        'modelId',
        'task',
        'dataset',
        'conclusion',
        'limitations',
        'date',
      ]) &&
      e.id &&
      e.title &&
      modelIds.has(e.modelId) &&
      Number.isInteger(e.sampleSize) &&
      Number(e.sampleSize) > 0 &&
      Number.isInteger(e.successCount) &&
      Number(e.successCount) >= 0 &&
      Number(e.successCount) <= Number(e.sampleSize) &&
      [e.latency, e.cost].every(
        (n) => n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0),
      ) &&
      typeof e.demo === 'boolean',
  );
  const validNotes = notes.every(
    (n) =>
      object(n) &&
      strings(n, ['id', 'title', 'body', 'source', 'date']) &&
      n.id &&
      n.title &&
      domains.some((d) => d === n.domain) &&
      stages.some((s) => s === n.stage) &&
      typeof n.demo === 'boolean' &&
      (!n.source || safeUrl(n.source)),
  );
  const validArtifacts = artifacts.every(
    (a) =>
      object(a) &&
      strings(a, ['id', 'title', 'content', 'date']) &&
      a.id &&
      a.title &&
      kinds.some((k) => k === a.kind) &&
      Array.isArray(a.modelIds) &&
      a.modelIds.every((id) => modelIds.has(id)),
  );
  return Boolean(validModels && validExperiments && validNotes && validArtifacts);
}
/**
 * 把用户输入转成普通文本，避免插入 HTML 时执行脚本。
 * @param {unknown} value
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c,
  );
}
/**
 * 触发文件下载，并在稍后释放临时 Blob 地址。
 * @param {string} filename
 * @param {string} content
 * @param {string} [mime]
 */
export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  // Windows 文件名不允许控制字符，需要显式过滤 U+0000–U+001F。
  // eslint-disable-next-line no-control-regex
  a.download = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
