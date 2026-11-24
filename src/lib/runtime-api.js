/** @typedef {import('../types').RuntimeHealth} RuntimeHealth */
/** @typedef {import('../types').RuntimeGraph} RuntimeGraph */
/** @typedef {import('../types').RuntimeRun} RuntimeRun */

/**
 * 确认接口返回的是对象，后续再逐项检查字段。
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function object(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/**
 * 检查运行窗口需要的服务和追踪配置字段。
 * @param {unknown} value
 * @returns {value is RuntimeHealth}
 */
function isHealth(value) {
  return (
    object(value) &&
    value.service === 'prism-research-server' &&
    typeof value.graph_id === 'string' &&
    typeof value.studio_url === 'string' &&
    object(value.tracing) &&
    typeof value.tracing.enabled === 'boolean' &&
    typeof value.tracing.key_configured === 'boolean' &&
    typeof value.tracing.project === 'string'
  );
}
/**
 * 检查图的节点和连线，避免异常返回让界面渲染失败。
 * @param {unknown} value
 * @returns {value is RuntimeGraph}
 */
function isGraph(value) {
  return (
    object(value) &&
    value.compiled === true &&
    typeof value.graph_id === 'string' &&
    object(value.graph) &&
    Array.isArray(value.graph.nodes) &&
    Array.isArray(value.graph.edges) &&
    value.graph.nodes.every(
      (n) => object(n) && (typeof n.id === 'string' || typeof n.id === 'number'),
    ) &&
    value.graph.edges.every(
      (e) => object(e) && typeof e.source === 'string' && typeof e.target === 'string',
    )
  );
}
/**
 * 检查运行编号、状态和结果，只有合法记录才进入页面。
 * @param {unknown} value
 * @returns {value is RuntimeRun}
 */
function isRun(value) {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    typeof value.graph_id === 'string' &&
    typeof value.input === 'string' &&
    typeof value.started_at === 'string' &&
    typeof value.status === 'string' &&
    ['pending', 'running', 'success', 'error', 'timeout', 'interrupted'].includes(value.status) &&
    (value.output == null || object(value.output)) &&
    typeof value.trace_status === 'string' &&
    ['unverified', 'verified'].includes(value.trace_status)
  );
}
/**
 * 把服务端错误整理成可直接展示的提示。
 * @param {unknown} detail
 */
function errorMessage(detail) {
  if (typeof detail === 'string') return detail;
  if (object(detail) && typeof detail.message === 'string') return detail.message;
  if (Array.isArray(detail)) return '请求内容不符合服务端要求，请检查输入。';
  return '请求失败，请检查服务状态后重试。';
}
/**
 * 统一发送运行请求；关闭窗口可取消等待，请求结束后清理计时和监听。
 * @param {string} path
 * @param {RequestInit} [options]
 * @param {AbortSignal} [signal]
 * @returns {Promise<unknown>}
 */
async function request(path, options = {}, signal) {
  const controller = new AbortController();
  // 用户关掉窗口和请求超时都会取消等待，结束后会移除对应监听和计时。
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 35000);
  try {
    const response = await fetch(`/api/runtime/${path}`, {
      ...options,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...options.headers },
      cache: 'no-store',
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new Error(
        response.ok
          ? '运行服务返回了无法识别的响应。'
          : '无法连接运行服务，请先在终端启动 Agent Server。',
      );
    }
    const data = /** @type {unknown} */ (await response.json());
    if (!response.ok) throw new Error(errorMessage(object(data) ? data.detail : undefined));
    return data;
  } catch (error) {
    if (signal?.aborted) throw new DOMException('请求已取消', 'AbortError');
    if (error instanceof DOMException && error.name === 'AbortError')
      throw new Error('请求超时。运行可能仍在服务端执行，可在记录中重新查询。', { cause: error });
    if (error instanceof TypeError)
      throw new Error('无法连接运行服务，请检查 Agent Server 是否启动。', { cause: error });
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
/**
 * 读取后端公开的运行与追踪配置。
 * @param {AbortSignal} [signal]
 */
export async function getHealth(signal) {
  const data = await request('health', {}, signal);
  if (!isHealth(data)) throw new Error('运行服务状态格式不匹配。');
  return data;
}
/**
 * 读取 Agent Server 已编译的图。
 * @param {AbortSignal} [signal]
 */
export async function getGraph(signal) {
  const data = await request('graph', {}, signal);
  if (!isGraph(data)) throw new Error('编译图格式不匹配。');
  return data;
}
/**
 * 分页读取服务端保存的运行记录。
 * @param {number} offset
 * @param {AbortSignal} [signal]
 */
export async function getRuns(offset = 0, signal) {
  const data = await request(`runs?limit=20&offset=${offset}`, {}, signal);
  if (!Array.isArray(data) || !data.every(isRun)) throw new Error('运行记录格式不匹配。');
  return data;
}
/**
 * 提交验证文字，创建一次新的图运行。
 * @param {string} prompt
 * @param {AbortSignal} [signal]
 */
export async function createRun(prompt, signal) {
  const data = await request('runs', { method: 'POST', body: JSON.stringify({ prompt }) }, signal);
  if (!isRun(data)) throw new Error('新运行记录格式不匹配。');
  return data;
}
/**
 * 查询指定运行的最新状态和结果。
 * @param {string} id
 * @param {AbortSignal} [signal]
 */
export async function getRun(id, signal) {
  const data = await request(`runs/${encodeURIComponent(id)}`, {}, signal);
  if (!isRun(data)) throw new Error('运行结果格式不匹配。');
  return data;
}
/**
 * 请求中断运行，并取回服务端确认的状态。
 * @param {string} id
 * @param {AbortSignal} [signal]
 */
export async function cancelRun(id, signal) {
  const data = await request(`runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }, signal);
  if (!isRun(data)) throw new Error('取消运行响应格式不匹配。');
  return data;
}
/**
 * 请后端到 LangSmith 查找并核验这次运行。
 * @param {string} id
 * @param {AbortSignal} [signal]
 */
export async function verifyTrace(id, signal) {
  const data = await request(`runs/${encodeURIComponent(id)}/trace`, { method: 'POST' }, signal);
  if (!isRun(data)) throw new Error('监测核验响应格式不匹配。');
  return data;
}
