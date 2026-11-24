import { icon } from './visuals.js';
import { escapeHtml as esc, safeUrl } from '../lib/workspace.js';
import * as api from '../lib/runtime-api.js';

/** 挂载右下角运行窗口，主页面重绘时保留输入和进行中的请求。 */
export function mountRuntimeConsole() {
  if (document.querySelector('#runtime-studio')) return;
  const root = document.createElement('section');
  root.id = 'runtime-studio';
  root.className = 'runtime-widget';
  root.setAttribute('aria-label', '运行工作室');
  document.body.append(root);
  let open = false;
  let loading = false;
  let busy = false;
  let historyTab = false;
  let more = false;
  let error = '';
  let draft = '验证 Prism 研究工作台与 Agent Server 的连接。';
  /** @type {import('../types').RuntimeHealth | null} */
  let health = null;
  /** @type {import('../types').RuntimeGraph | null} */
  let graph = null;
  /** @type {import('../types').RuntimeRun[]} */
  let history = [];
  /** @type {import('../types').RuntimeRun | null} */
  let active = null;
  /** @type {AbortController | null} */
  let controller = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pollTimer;
  const terminal = new Set(['success', 'error', 'timeout', 'interrupted']);
  const statusLabels = {
    pending: '准备中',
    running: '运行中',
    success: '已完成',
    error: '失败',
    timeout: '超时',
    interrupted: '已中断',
  };
  /**
   * 把请求异常变成页面提示，主动取消请求时不显示报错。
   * @param {unknown} caught
   */
  function setError(caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    error = caught instanceof Error ? caught.message : '请求失败，请重试。';
  }
  /** 开始新请求前取消旧等待和轮询，避免旧结果覆盖新状态。 */
  function begin() {
    controller?.abort();
    clearTimeout(pollTimer);
    controller = new AbortController();
    return controller.signal;
  }
  /**
   * 同时更新当前运行与历史列表，按编号去重。
   * @param {import('../types').RuntimeRun} record
   */
  function updateRun(record) {
    active = record;
    const index = history.findIndex((r) => r.id === record.id);
    if (index === -1) history.unshift(record);
    else history[index] = record;
  }
  /**
   * 展示一次运行的输入、结果、状态和追踪核验信息。
   * @param {import('../types').RuntimeRun} record
   */
  function recordView(record) {
    return `<div class="runtime-result"><div class="runtime-result-top"><strong>本次验证</strong><span class="runtime-status status-${record.status}">${statusLabels[record.status]}</span></div><p class="runtime-input">${esc(record.input)}</p>${record.output ? `<p class="runtime-output">${esc(record.output.message || '执行完成')}</p><details class="runtime-json"><summary>查看返回数据</summary><pre>${esc(JSON.stringify(record.output, null, 2))}</pre></details>` : ''}${record.error ? `<p class="runtime-error">${esc(record.error)}</p>` : ''}<div class="runtime-identifiers"><span>运行编号</span><code>${esc(record.agent_run_id || record.id)}</code></div><div class="runtime-trace"><span>${record.trace_status === 'verified' ? 'LangSmith 记录已核验' : 'LangSmith 记录未核验'}</span>${record.trace_url && safeUrl(record.trace_url) ? `<a href="${esc(safeUrl(record.trace_url))}" target="_blank" rel="noopener noreferrer">查看监测 ${icon('external')}</a>` : `<button data-runtime="trace" ${!record.agent_run_id || busy ? 'disabled' : ''}>核验监测</button>`}</div>${!terminal.has(record.status) ? `<div class="runtime-run-controls"><button data-runtime="refresh-run" ${busy ? 'disabled' : ''}>刷新状态</button><button data-runtime="cancel" ${busy ? 'disabled' : ''}>中断运行</button></div>` : ''}</div>`;
  }
  /** 展示图结构、服务状态和验证输入框。 */
  function graphView() {
    const tracing = health?.tracing;
    return `<div class="runtime-health"><div><span class="runtime-dot ${health ? 'connected' : ''}"></span><span>${health ? 'Agent Server 在线' : '等待服务连接'}</span></div><button data-runtime="refresh" class="runtime-refresh" ${loading || busy ? 'disabled' : ''}>${loading ? '检查中…' : '重新检查'}</button></div>${graph ? `<div class="runtime-graph"><div class="runtime-graph-label"><span>已读取编译图</span><code>${esc(graph.graph_id)}</code></div><div class="runtime-nodes">${graph.graph.nodes.map((n, i) => `${i ? '<span class="runtime-connector" aria-hidden="true"></span>' : ''}<span class="runtime-node ${n.id === 'connection_check' ? 'runtime-node-main' : ''}">${n.id === '__start__' ? '输入' : n.id === '__end__' ? '输出' : n.id === 'connection_check' ? '连通性验证' : esc(n.id)}</span>`).join('')}</div></div>` : ''}<div class="runtime-observability"><span>LangSmith</span><strong>${tracing?.enabled && tracing.key_configured ? '已配置，待核验实际运行' : '等待本地 .env 配置'}</strong>${health && safeUrl(health.studio_url) ? `<a href="${esc(safeUrl(health.studio_url))}" target="_blank" rel="noopener noreferrer">打开 Studio ${icon('external')}</a>` : ''}</div><form class="runtime-form"><label for="runtime-prompt">验证输入</label><textarea id="runtime-prompt" name="prompt" rows="3" required maxlength="4000" placeholder="输入一段用于验证连接的文字" ${busy || (active && !terminal.has(active.status)) ? 'disabled' : ''}>${esc(draft)}</textarea><div class="runtime-form-bottom"><span>框架验证 · 不调用 AI 模型</span><button type="submit" class="button primary" ${!graph || loading || busy || (active && !terminal.has(active.status)) ? 'disabled' : ''}>${icon('experiments')}${busy ? '提交中…' : '运行验证'}</button></div></form>${active ? recordView(active) : '<div class="runtime-first-run">执行一次验证，确认前端、SDK 与图服务的调用链路。</div>'}`;
  }
  /** 展示已保存的历史运行，并支持继续加载更早记录。 */
  function historyView() {
    return `<div class="runtime-history-label"><span>服务端保存的运行记录</span><button data-runtime="refresh" ${loading || busy ? 'disabled' : ''}>${loading ? '读取中…' : '刷新'}</button></div>${history.length ? history.map((r) => `<button class="runtime-history-item ${active?.id === r.id ? 'current' : ''}" data-runtime="select-run" data-run-id="${esc(r.id)}"><span class="runtime-history-icon">${icon('experiments')}</span><span class="runtime-history-copy"><strong>${esc(r.input)}</strong><span>${esc(new Date(r.started_at).toLocaleString('zh-CN', { hour12: false }))}</span></span><span class="runtime-status status-${r.status}">${statusLabels[r.status]}</span></button>`).join('') : '<div class="runtime-first-run">还没有运行记录。到“图与连接”执行第一次验证。</div>'}${more ? `<button class="runtime-more" data-runtime="more" ${loading || busy ? 'disabled' : ''}>加载更早记录</button>` : ''}`;
  }
  /** 重绘运行窗口，展开和收起共用同一个挂载节点。 */
  function render() {
    root.innerHTML = `${open ? `<div class="runtime-panel" role="region" aria-label="运行工作室面板"><header class="runtime-header"><span class="runtime-mark">${icon('experiments')}</span><div><h2>运行工作室</h2><p>从研究记录，走向可执行的验证。</p></div><button class="icon-button" data-runtime="close" aria-label="关闭运行工作室">${icon('close')}</button></header><div class="runtime-tabs"><button data-runtime="graph-tab" class="${!historyTab ? 'active' : ''}" aria-pressed="${!historyTab}">图与连接</button><button data-runtime="history-tab" class="${historyTab ? 'active' : ''}" aria-pressed="${historyTab}">运行记录 <span>${history.length}</span></button></div><div class="runtime-body" aria-busy="${loading}">${loading && !health ? '<div class="runtime-loading">正在检查服务、编译图与运行记录…</div>' : ''}${error ? `<div class="runtime-error" role="alert">${esc(error)}</div>` : ''}${historyTab ? historyView() : graphView()}</div><footer class="runtime-footer">2.2 框架联通 · 真实模型在下一阶段接入</footer></div>` : ''}<button class="runtime-launcher" data-runtime="toggle" aria-expanded="${open}" aria-label="${open ? '关闭' : '打开'}运行工作室">${icon(open ? 'close' : 'experiments')}<span>${open ? '收起工作室' : '运行工作室'}</span><span class="runtime-launcher-dot ${health ? 'connected' : ''}" aria-hidden="true"></span></button>`;
  }
  /** 重新读取服务、编译图和历史记录，需要时恢复未结束运行的轮询。 */
  async function load() {
    const signal = begin();
    loading = true;
    error = '';
    render();
    let healthReached = false;
    try {
      health = await api.getHealth(signal);
      healthReached = true;
      const [compiled, records] = await Promise.all([api.getGraph(signal), api.getRuns(0, signal)]);
      if (signal.aborted) return;
      graph = compiled;
      history = records;
      more = records.length === 20;
      if (active) active = history.find((r) => r.id === active?.id) ?? active;
      else active = records.find((r) => !terminal.has(r.status)) ?? null;
      if (active && !terminal.has(active.status)) schedulePoll();
    } catch (caught) {
      if (!signal.aborted) {
        if (!healthReached) health = null;
        graph = null;
        setError(caught);
      }
    } finally {
      if (!signal.aborted) {
        loading = false;
        render();
      }
    }
  }
  /** 只有窗口展开且运行未结束时，才安排下一次状态查询。 */
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (open && active && !terminal.has(active.status))
      pollTimer = setTimeout(() => void refreshRun(), 1200);
  }
  /** 查询当前运行，成功后继续轮询，失败时保留已有结果供重试。 */
  async function refreshRun() {
    if (!active || !open) return;
    const currentId = active.id;
    const signal = controller?.signal;
    try {
      updateRun(await api.getRun(currentId, signal));
      error = '';
      render();
      schedulePoll();
    } catch (caught) {
      if (!signal?.aborted) {
        setError(caught);
        render();
      }
    }
  }
  /** 收起窗口并取消浏览器中的请求等待和轮询，服务端运行仍独立执行。 */
  function close() {
    open = false;
    loading = false;
    busy = false;
    controller?.abort();
    clearTimeout(pollTimer);
    render();
    root.querySelector('button')?.focus();
  }
  root.addEventListener('input', (event) => {
    if (event.target instanceof HTMLTextAreaElement && event.target.id === 'runtime-prompt')
      draft = event.target.value;
  });
  root.addEventListener('submit', async (event) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    event.preventDefault();
    if (busy || !graph || (active && !terminal.has(active.status))) return;
    if (!draft.trim()) {
      error = '请输入验证内容。';
      render();
      return;
    }
    const signal = begin();
    busy = true;
    error = '';
    render();
    try {
      updateRun(await api.createRun(draft.trim(), signal));
      schedulePoll();
    } catch (caught) {
      if (!signal.aborted) setError(caught);
    } finally {
      if (!signal.aborted) {
        busy = false;
        render();
      }
    }
  });
  root.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return;
    const button = event.target.closest('[data-runtime]');
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    const action = button.dataset.runtime;
    if (action === 'close' || (action === 'toggle' && open)) {
      close();
      return;
    }
    if (action === 'toggle') {
      open = true;
      await load();
      const input = root.querySelector('#runtime-prompt');
      if (input instanceof HTMLTextAreaElement) input.focus();
      return;
    }
    if (action === 'graph-tab' || action === 'history-tab') {
      historyTab = action === 'history-tab';
      render();
      return;
    }
    if (action === 'refresh') {
      await load();
      return;
    }
    if (action === 'refresh-run') {
      await refreshRun();
      return;
    }
    if (busy || loading) return;
    const signal = begin();
    busy = true;
    error = '';
    render();
    try {
      if (action === 'more') {
        const records = await api.getRuns(history.length, signal);
        history.push(...records);
        more = records.length === 20;
      }
      if (action === 'select-run' && button.dataset.runId) {
        updateRun(await api.getRun(button.dataset.runId, signal));
        historyTab = false;
        schedulePoll();
      }
      if (action === 'trace' && active) updateRun(await api.verifyTrace(active.id, signal));
      if (action === 'cancel' && active) {
        updateRun(await api.cancelRun(active.id, signal));
        schedulePoll();
      }
    } catch (caught) {
      if (!signal.aborted) setError(caught);
    } finally {
      if (!signal.aborted) {
        busy = false;
        render();
        schedulePoll();
      }
    }
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
  });
  window.addEventListener('pagehide', () => {
    controller?.abort();
    clearTimeout(pollTimer);
  });
  render();
}
