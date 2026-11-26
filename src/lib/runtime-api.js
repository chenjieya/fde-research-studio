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
    (value.input_media === undefined ||
      (Array.isArray(value.input_media) && value.input_media.every(isMedia))) &&
    typeof value.started_at === 'string' &&
    typeof value.status === 'string' &&
    ['pending', 'running', 'success', 'error', 'timeout', 'interrupted'].includes(value.status) &&
    (value.output == null ||
      (object(value.output) &&
        (value.output.media === undefined ||
          (Array.isArray(value.output.media) && value.output.media.every(isMedia))))) &&
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
 * @param {number} [timeoutMs]
 * @returns {Promise<unknown>}
 */
async function request(path, options = {}, signal, timeoutMs = 35000) {
  const controller = new AbortController();
  // 用户关掉窗口和请求超时都会取消等待，结束后会移除对应监听和计时。
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
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
 * @param {string} modelId
 * @param {string} conversationId
 * @param {AbortSignal} [signal]
 * @param {string[]} [attachmentIds]
 * @param {import('../types').GenerationMode} [generationMode]
 */
export async function createRun(
  prompt,
  modelId,
  conversationId,
  signal,
  attachmentIds = [],
  generationMode,
) {
  const data = await request(
    'runs',
    {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        model_id: modelId,
        conversation_id: conversationId,
        attachment_ids: attachmentIds,
        generation_mode: generationMode,
      }),
    },
    signal,
  );
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

/** @param {unknown} value @returns {value is import('../types').ModelConnection} */
function isModelConnection(value) {
  return (
    object(value) &&
    typeof value.model_id === 'string' &&
    typeof value.name === 'string' &&
    [
      'openai',
      'anthropic',
      'qwen',
      'nvidia_cosmos',
      'openai_image',
      'qwen_image',
      'seedance',
      'wan',
      'krea',
      'moss_image',
      'minimax_image',
    ].includes(String(value.provider)) &&
    Array.isArray(value.supported_modes) &&
    value.supported_modes.every((mode) =>
      ['text2image', 'image2image', 'text2video', 'image2video', 'video2video'].includes(
        String(mode),
      ),
    ) &&
    Array.isArray(value.input_modalities) &&
    value.input_modalities.every((kind) => ['image', 'video'].includes(String(kind))) &&
    ['text2image', 'image2image', 'text2video', 'image2video', 'video2video'].includes(
      String(value.generation_mode),
    ) &&
    object(value.generation) &&
    typeof value.generation.resolution === 'string' &&
    typeof value.generation.num_frames === 'number' &&
    typeof value.generation.num_inference_steps === 'number' &&
    typeof value.generation.fps === 'number' &&
    typeof value.generation.image_size === 'string' &&
    typeof value.generation.duration === 'number' &&
    typeof value.generation.aspect_ratio === 'string' &&
    typeof value.generation.video_resolution === 'string' &&
    typeof value.api_model === 'string' &&
    typeof value.base_url === 'string' &&
    typeof value.enabled === 'boolean' &&
    typeof value.system_prompt === 'string' &&
    typeof value.api_key_configured === 'boolean' &&
    Number.isInteger(value.revision) &&
    typeof value.max_tokens === 'number' &&
    typeof value.timeout_seconds === 'number' &&
    ['off', 'on', 'default'].includes(String(value.qwen_thinking)) &&
    (value.temperature === null || typeof value.temperature === 'number')
  );
}

/** @returns {Promise<import('../types').ProviderDefinition[]>} */
export async function getProviders() {
  const data = await request('providers');
  if (
    !Array.isArray(data) ||
    !data.every(
      (item) =>
        object(item) &&
        typeof item.id === 'string' &&
        typeof item.label === 'string' &&
        typeof item.base_url === 'string' &&
        typeof item.api_model === 'string' &&
        typeof item.hint === 'string' &&
        typeof item.documentation === 'string' &&
        typeof item.timeout_seconds === 'number' &&
        Array.isArray(item.modes) &&
        item.modes.every((mode) =>
          ['text2image', 'image2image', 'text2video', 'image2video', 'video2video'].includes(
            String(mode),
          ),
        ),
    )
  )
    throw new Error('服务端接入目录格式不匹配。');
  return data;
}

/** @param {unknown} value @returns {value is import('../types').MediaAsset} */
function isMedia(value) {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    /^[0-9a-f-]{36}$/.test(value.id) &&
    (value.kind === 'image' || value.kind === 'video') &&
    typeof value.mime_type === 'string' &&
    typeof value.filename === 'string' &&
    typeof value.size === 'number' &&
    value.size > 0 &&
    value.url === `/api/runtime/media/${value.id}`
  );
}

/** 二进制文件上传，密钥仍只在服务端使用。 @param {File} file @param {AbortSignal} [signal] */
export async function uploadMedia(file, signal) {
  const data = await request(
    `media?filename=${encodeURIComponent(file.name.slice(0, 200))}`,
    {
      method: 'POST',
      body: file,
      headers: { 'Content-Type': file.type },
    },
    signal,
    120000,
  );
  if (!isMedia(data)) throw new Error('媒体上传响应格式不匹配。');
  return data;
}
/** @param {AbortSignal} [signal] */
export async function getModelConnections(signal) {
  const data = await request('models', {}, signal);
  if (!Array.isArray(data) || !data.every(isModelConnection))
    throw new Error('模型接入配置格式不匹配。');
  return data;
}
/** @param {string} id @param {import('../types').ModelConnectionInput} payload @param {AbortSignal} [signal] */
export async function saveModelConnection(id, payload, signal) {
  const data = await request(
    `models/${encodeURIComponent(id)}`,
    { method: 'PUT', body: JSON.stringify(payload) },
    signal,
  );
  if (!isModelConnection(data)) throw new Error('模型配置保存响应格式不匹配。');
  return data;
}
/** @param {unknown} value @returns {value is import('../types').Conversation} */
function isConversation(value) {
  return (
    object(value) &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.created_at === 'string' &&
    typeof value.updated_at === 'string'
  );
}
/** @param {number} [offset] @param {AbortSignal} [signal] */
export async function getConversations(offset = 0, signal) {
  const data = await request(`conversations?offset=${offset}`, {}, signal);
  if (!Array.isArray(data) || !data.every(isConversation)) throw new Error('对话列表格式不匹配。');
  return data;
}
/** @param {AbortSignal} [signal] */
export async function createConversation(signal) {
  const data = await request('conversations', { method: 'POST' }, signal);
  if (!isConversation(data)) throw new Error('新对话格式不匹配。');
  return data;
}
/** @param {string} id @param {AbortSignal} [signal] */
export async function getConversationRuns(id, signal) {
  const data = await request(`conversations/${encodeURIComponent(id)}/runs`, {}, signal);
  if (!Array.isArray(data) || !data.every(isRun)) throw new Error('对话记录格式不匹配。');
  return data;
}
/** @param {string} id @param {import('../types').Experiment} payload */
export async function confirmExperiment(id, payload) {
  const data = await request(`runs/${encodeURIComponent(id)}/experiment`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!object(data) || typeof data.id !== 'string') throw new Error('实验保存响应格式不匹配。');
  return data.id;
}
/** @param {string} id @param {AbortSignal} [signal] */
export async function getExperimentSource(id, signal) {
  const data = await request(`experiments/${encodeURIComponent(id)}/source`, {}, signal);
  if (data !== null && !isRun(data)) throw new Error('实验来源格式不匹配。');
  return data;
}
