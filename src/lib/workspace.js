import { initialWorkspace } from '../mocks/data.js';
const KEY = 'prism-research-workspace-v1';
export const domains = /** @type {const} */ (['图片', 'CAD', '视频']);
export const stages = /** @type {const} */ (['待调研', '研究中', '已验证', '持续跟踪']);
export const kinds = /** @type {const} */ (['研究周报', '模型对比报告', 'FDE 方案草稿', '技术调研简报']);
/** @param {string} prefix */
export function uid(prefix) { return `${prefix}-${crypto.randomUUID()}`; }
export function today() { return new Date().toLocaleDateString('sv-SE'); }
/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value) { return typeof value === 'object' && value !== null && !Array.isArray(value); }
/** @param {Record<string, unknown>} value @param {string[]} keys */
function strings(value, keys) { return keys.every(key => typeof value[key] === 'string' && value[key].length <= 200000); }
/** @param {unknown} value */
export function safeUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; }
}
/** Validate every imported record before it can replace local work. @param {unknown} value @returns {value is import('../types').Workspace} */
export function isWorkspace(value) {
  if (!object(value) || value.version !== 1) return false;
  const listKeys = ['models', 'experiments', 'notes', 'artifacts'];
  if (!listKeys.every(key => Array.isArray(value[key]) && value[key].length <= 10000)) return false;
  const { models, experiments, notes, artifacts } = value;
  if (!Array.isArray(models) || !Array.isArray(experiments) || !Array.isArray(notes) || !Array.isArray(artifacts)) return false;
  const unique = /** @param {unknown[]} rows */ rows => rows.every(object) && new Set(rows.map(row => object(row) ? row.id : null)).size === rows.length;
  if (![models, experiments, notes, artifacts].every(unique)) return false;
  const validModels = models.every(m => object(m) && strings(m, ['id', 'name', 'vendor', 'summary', 'route', 'access', 'license', 'source', 'updated', 'notes']) && m.id && m.name && domains.some(d => d === m.domain) && stages.some(s => s === m.stage) && Array.isArray(m.capabilities) && m.capabilities.length > 0 && m.capabilities.every(c => c === '生成编辑' || c === '识别理解') && typeof m.demo === 'boolean' && typeof m.favorite === 'boolean' && (!m.source || safeUrl(m.source)));
  const modelIds = new Set(models.filter(object).map(m => m.id));
  const validExperiments = experiments.every(e => object(e) && strings(e, ['id', 'title', 'modelId', 'task', 'dataset', 'conclusion', 'limitations', 'date']) && e.id && e.title && modelIds.has(e.modelId) && Number.isInteger(e.sampleSize) && Number(e.sampleSize) > 0 && Number.isInteger(e.successCount) && Number(e.successCount) >= 0 && Number(e.successCount) <= Number(e.sampleSize) && [e.latency, e.cost].every(n => n === null || (typeof n === 'number' && Number.isFinite(n) && n >= 0)) && typeof e.demo === 'boolean');
  const validNotes = notes.every(n => object(n) && strings(n, ['id', 'title', 'body', 'source', 'date']) && n.id && n.title && domains.some(d => d === n.domain) && stages.some(s => s === n.stage) && typeof n.demo === 'boolean' && (!n.source || safeUrl(n.source)));
  const validArtifacts = artifacts.every(a => object(a) && strings(a, ['id', 'title', 'content', 'date']) && a.id && a.title && kinds.some(k => k === a.kind) && Array.isArray(a.modelIds) && a.modelIds.every(id => modelIds.has(id)));
  return Boolean(validModels && validExperiments && validNotes && validArtifacts);
}
/** @returns {{ data: import('../types').Workspace, error: string }} */
export function readWorkspace() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { data: structuredClone(initialWorkspace), error: '' };
    const parsed = JSON.parse(raw);
    if (!isWorkspace(parsed)) throw new Error('保存的数据格式不完整');
    return { data: parsed, error: '' };
  } catch { return { data: structuredClone(initialWorkspace), error: '无法读取本地记录。当前展示示例数据；原数据未被覆盖。请先导出或检查浏览器存储。' }; }
}
/** Persist before updating the visible state. A storage failure must never look like a successful save. @param {import('../types').Workspace} data */
export function persistWorkspace(data) {
  if (!isWorkspace(data)) throw new Error('数据校验失败，请检查记录内容。');
  localStorage.setItem(KEY, JSON.stringify(data));
}
/** @param {unknown} value */
export function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c)); }
/** @param {string} filename @param {string} content @param {string} [mime] */
export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = filename.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_'); a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
