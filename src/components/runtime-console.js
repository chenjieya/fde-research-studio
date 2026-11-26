import { icon } from './visuals.js';
import { escapeHtml as esc, safeUrl } from '../lib/workspace.js';
import * as api from '../lib/runtime-api.js';
import { mediaView } from './media-view.js';
import { generationLabels } from './model-connection.js';

/** 聊天窗口独立挂载，研究页面切换时保留会话与草稿。 */
export function mountRuntimeConsole() {
  if (document.querySelector('#runtime-studio')) return;
  const root = document.createElement('section');
  root.id = 'runtime-studio';
  root.className = 'runtime-widget';
  root.setAttribute('aria-label', '运行工作室');
  document.body.append(root);
  let open = false,
    loading = false,
    busy = false,
    historyOpen = false,
    more = false;
  let error = '',
    draft = '',
    selectedModel = '',
    conversationId = '';
  /** @type {import('../types').ModelConnection[]} */
  let models = [];
  /** @type {import('../types').MediaAsset[]} */
  let attachments = [];
  /** @type {import('../types').GenerationMode} */
  let generationMode = 'text2video';
  /** @type {import('../types').Conversation[]} */
  let conversations = [];
  /** @type {import('../types').RuntimeRun[]} */
  let messages = [];
  /** @type {import('../types').RuntimeHealth | null} */
  let health = null;
  /** @type {AbortController | null} */
  let controller = null;
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let pollTimer;
  const terminal = new Set(['success', 'error', 'timeout', 'interrupted']);
  const statusLabels = {
    pending: '准备中',
    running: '思考中',
    success: '已完成',
    error: '失败',
    timeout: '超时',
    interrupted: '已中断',
  };
  const activeRun = () => messages.find((r) => !terminal.has(r.status));
  const currentModel = () => models.find((m) => m.model_id === selectedModel);
  const modeLabels = generationLabels;
  function acceptedKinds() {
    const model = currentModel();
    return model?.supported_modes.length
      ? generationMode === 'image2video' || generationMode === 'image2image'
        ? ['image']
        : generationMode === 'video2video'
          ? ['video']
          : []
      : model?.input_modalities || [];
  }
  function acceptedTypes() {
    const kinds = acceptedKinds();
    const cosmos = !!currentModel()?.supported_modes.length;
    return [
      ...(kinds.includes('image')
        ? ['image/png', 'image/jpeg', 'image/webp', ...(cosmos ? [] : ['image/gif'])]
        : []),
      ...(kinds.includes('video') ? ['video/mp4', ...(cosmos ? [] : ['video/webm'])] : []),
    ];
  }
  /** 顺序上传，部分失败时保留已经上传的素材和草稿。 @param {File[]} files */
  async function upload(files) {
    if (!open || busy || loading || activeRun() || !files.length) return;
    const kinds = acceptedKinds();
    if (attachments.length + files.length > 6) {
      error = '每轮最多添加 6 个附件。';
      render();
      return;
    }
    for (const file of files) {
      const kind = file.type.startsWith('image/') ? 'image' : 'video';
      if (!acceptedTypes().includes(file.type) || !kinds.includes(kind)) {
        error = '此模型或任务不支持所选文件，请检查素材类型。';
        render();
        return;
      }
      if (file.size > (kind === 'image' ? 10 : 32) * 1024 * 1024) {
        error = '图片上限 10 MB，视频上限 32 MB。';
        render();
        return;
      }
    }
    const signal = begin();
    busy = true;
    error = '';
    render();
    try {
      for (const file of files) {
        const asset = await api.uploadMedia(file, signal);
        if (signal.aborted) return;
        attachments.push(asset);
        render();
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
  }
  /** 用户操作取消旧请求，防止切换会话后旧响应覆盖页面。 */
  function begin() {
    controller?.abort();
    clearTimeout(pollTimer);
    controller = new AbortController();
    return controller.signal;
  }
  /** @param {unknown} caught */
  function setError(caught) {
    if (caught instanceof DOMException && caught.name === 'AbortError') return;
    error = caught instanceof Error ? caught.message : '请求失败，请重试。';
  }
  /** @param {import('../types').RuntimeRun} run */
  function update(run) {
    const index = messages.findIndex((item) => item.id === run.id);
    if (index < 0) messages.push(run);
    else messages[index] = run;
  }
  /** @param {import('../types').RuntimeRun} run */
  function turnView(run) {
    const output = run.output;
    const success = run.status === 'success' && output?.execution_mode === 'model';
    const traceUrl = safeUrl(run.trace_url || '');
    return `<article class="chat-turn"><div class="chat-user"><span class="chat-role">你</span><p>${esc(run.input)}</p>${mediaView(run.input_media)}</div><div class="chat-assistant"><div class="chat-model-label">${icon('spark')}<strong>${esc(run.model_snapshot?.name || '历史模型')}</strong><small>${esc(run.model_snapshot?.api_model || '')}</small><span class="runtime-status status-${run.status}">${statusLabels[run.status]}</span></div>${output ? `<div class="chat-response">${esc(output.message || '')}</div>${mediaView(output.media)}` : !terminal.has(run.status) ? '<div class="chat-thinking" role="status"><i></i><i></i><i></i><span>正在处理素材与生成结果…</span></div>' : ''}${run.error ? `<p class="runtime-error">${esc(run.error)}</p>` : ''}<div class="chat-turn-actions">${success ? `<button data-runtime="experiment" data-run-id="${esc(run.id)}">${icon('experiments')}录入实验</button><span>${typeof output.latency_seconds === 'number' ? output.latency_seconds + 's' : ''}${output.usage && typeof output.usage === 'object' && 'total_tokens' in output.usage ? ` · ${esc(output.usage.total_tokens)} tokens` : ''}</span>` : ''}${traceUrl ? `<a href="${esc(traceUrl)}" target="_blank" rel="noopener noreferrer">查看追踪 ${icon('external')}</a>` : run.agent_run_id ? `<button data-runtime="trace" data-run-id="${esc(run.id)}" ${busy ? 'disabled' : ''}>核验追踪</button>` : ''}</div>${!terminal.has(run.status) ? `<button class="chat-cancel" data-runtime="cancel" data-run-id="${esc(run.id)}" ${busy ? 'disabled' : ''}>中断本轮</button>` : ''}</div></article>`;
  }
  function render() {
    const playback = Array.from(root.querySelectorAll('video')).map((video) => ({
      src: video.getAttribute('src'),
      time: video.currentTime,
      paused: video.paused,
    }));
    const focused = document.activeElement;
    const hadFocus = focused instanceof HTMLTextAreaElement && focused.id === 'runtime-prompt';
    const selection = hadFocus ? [focused.selectionStart, focused.selectionEnd] : null;
    const scrollNode = root.querySelector('.chat-messages');
    const scrollTop = scrollNode?.scrollTop || 0;
    const nearBottom =
      !scrollNode || scrollNode.scrollHeight - scrollNode.scrollTop - scrollNode.clientHeight < 80;
    const active = activeRun();
    const model = currentModel();
    const kinds = acceptedKinds();
    const locked = loading || busy || !!active;
    const accept = acceptedTypes().join(',');
    const mediaDraft = attachments
      .map(
        (asset) =>
          `<div class="chat-draft-item">${mediaView([asset])}<button type="button" data-runtime="remove-media" data-media-id="${esc(asset.id)}" aria-label="移除 ${esc(asset.filename)}" ${locked ? 'disabled' : ''}>${icon('close')}</button></div>`,
      )
      .join('');
    const modePicker = model?.supported_modes.length
      ? `<div class="chat-generation"><label>生成任务<select name="generation_mode" ${locked ? 'disabled' : ''}>${model.supported_modes
          .map((mode) => [mode, modeLabels[mode]])
          .map(
            ([value, label]) =>
              `<option value="${value}" ${generationMode === value ? 'selected' : ''}>${label}</option>`,
          )
          .join(
            '',
          )}</select></label><span>${esc(model.provider === 'nvidia_cosmos' ? model.generation.resolution.replace(/_/g, ' / ') : generationMode.endsWith('image') ? (model.provider === 'krea' ? '1K · ' + model.generation.aspect_ratio : model.generation.image_size) : model.generation.video_resolution + ' · ' + model.generation.duration + ' 秒')}</span></div>`
      : '';
    const title = conversations.find((item) => item.id === conversationId)?.title || '新对话';
    root.innerHTML = `${open ? `<div class="runtime-panel chat-panel"><header class="runtime-header"><div class="runtime-mark">${icon('spark')}</div><div><p class="chat-eyebrow">PRISM / PLAYGROUND</p><h2>运行工作室</h2></div><button class="icon-button" data-runtime="close" aria-label="关闭运行工作室">${icon('close')}</button></header><div class="chat-toolbar"><button class="chat-history-toggle" data-runtime="history" aria-expanded="${historyOpen}">${icon('clock')}<span>${esc(title)}</span>${icon('down')}</button><button class="icon-button" data-runtime="new" ${loading || busy ? 'disabled' : ''} aria-label="新建对话" title="新建对话">${icon('plus')}</button><button class="icon-button" data-runtime="refresh" ${loading || busy ? 'disabled' : ''} aria-label="刷新对话" title="刷新对话">${icon('refresh')}</button></div>${historyOpen ? `<div class="chat-history"><span class="eyebrow">对话记录</span>${conversations.map((c) => `<button data-runtime="select" data-conversation-id="${esc(c.id)}" ${busy || loading ? 'disabled' : ''} class="${c.id === conversationId ? 'selected' : ''}"><strong>${esc(c.title)}</strong><small>${esc(new Date(c.updated_at).toLocaleDateString('zh-CN'))}</small></button>`).join('') || '<p class="muted">还没有对话记录。</p>'}${more ? `<button data-runtime="more" ${busy || loading ? 'disabled' : ''}>更早的对话</button>` : ''}</div>` : ''}<div class="chat-messages" aria-live="polite" aria-busy="${loading || !!active}">${loading ? '<div class="chat-empty"><p>正在读取对话…</p></div>' : messages.length ? messages.map(turnView).join('') : `<div class="chat-empty"><div class="chat-orbit">${icon('spark')}</div><p class="eyebrow">从一个问题开始</p><h3>让想法，进入验证。</h3><p>上传图片、视频，分析内容，或验证生成效果。<br>素材、结果与实验记录一起保留。</p>${!models.length ? '<a href="#models" data-runtime-link="configure">前往模型档案，配置接入 →</a>' : '<button class="chat-suggestion" data-runtime="suggest">如何设计一次公平的多模态模型对比？</button>'}</div>`}</div>${error ? `<div class="chat-error" role="alert">${esc(error)}</div>` : ''}<form class="chat-composer">${modePicker}${attachments.length ? `<div class="chat-draft-media">${mediaDraft}</div>` : ''}<label class="sr-only" for="runtime-prompt">发送给模型的消息</label><textarea id="runtime-prompt" name="prompt" rows="3" maxlength="20000" placeholder="描述要分析或生成的内容，也可以添加图片、视频" ${loading || busy || active ? 'disabled' : ''}>${esc(draft)}</textarea><div class="chat-composer-bottom"><label class="chat-attach" title="添加素材"><input type="file" data-runtime-files multiple accept="${accept}" ${locked || !kinds.length ? 'disabled' : ''} aria-label="添加图片或视频">${icon('upload')}</label><label class="chat-model-picker"><span class="sr-only">本轮模型</span>${icon('models')}<select name="model" aria-label="本轮模型" ${loading || busy || active ? 'disabled' : ''}>${models.length ? models.map((m) => `<option value="${esc(m.model_id)}" ${m.model_id === selectedModel ? 'selected' : ''}>${esc(m.name)} · ${esc(m.api_model)}</option>`).join('') : '<option value="">请先配置模型</option>'}</select></label><button type="submit" class="chat-send" aria-label="发送消息" ${!models.length || loading || busy || active ? 'disabled' : ''}>${icon('chevron')}</button></div><p class="chat-input-hint">${busy ? '正在提交，请稍候…' : model?.supported_modes.length ? '本轮素材与提示词用于生成；结果完成后可预览和下载。' : kinds.length ? `可添加${kinds.includes('image') ? '图片' : ''}${kinds.length > 1 ? '、' : ''}${kinds.includes('video') ? '视频' : ''}，支持拖放和粘贴图片。` : '此接入配置仅启用了文本输入。'}</p></form><footer class="chat-footer"><span><i class="runtime-dot ${health ? 'connected' : ''}"></i>${health ? '已连接 · 切换模型后继续对话' : '等待服务连接'}</span>${health && safeUrl(health.studio_url) ? `<a href="${esc(safeUrl(health.studio_url))}" target="_blank" rel="noopener noreferrer">Studio ${icon('external')}</a>` : ''}</footer></div>` : ''}<button class="runtime-launcher" data-runtime="toggle" aria-expanded="${open}"><span class="runtime-launcher-dot ${health ? 'connected' : ''}"></span>${icon('spark')}运行工作室${icon(open ? 'down' : 'plus')}</button>`;
    for (const video of root.querySelectorAll('video')) {
      const previous = playback.find((item) => item.src === video.getAttribute('src'));
      if (!previous || !previous.time) continue;
      const restore = () => {
        video.currentTime = previous.time;
        if (!previous.paused) void video.play().catch(() => {});
      };
      if (video.readyState >= 1) restore();
      else video.addEventListener('loadedmetadata', restore, { once: true });
    }
    const nextScroll = root.querySelector('.chat-messages');
    if (nextScroll) nextScroll.scrollTop = nearBottom ? nextScroll.scrollHeight : scrollTop;
    const input = root.querySelector('#runtime-prompt');
    if (hadFocus && input instanceof HTMLTextAreaElement && !input.disabled) {
      input.focus();
      if (selection) input.setSelectionRange(selection[0], selection[1]);
    }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (!open || busy || loading || !activeRun()) return;
    pollTimer = setTimeout(() => {
      void refreshActive();
    }, 1200);
  }
  async function refreshActive() {
    const active = activeRun();
    if (!open || busy || loading || !active) return;
    const signal = controller?.signal;
    try {
      const record = await api.getRun(active.id, signal);
      if (signal?.aborted) return;
      update(record);
      error = '';
    } catch (caught) {
      if (!signal?.aborted) setError(caught);
    }
    if (!signal?.aborted) {
      render();
      schedulePoll();
    }
  }
  async function load() {
    const signal = begin();
    loading = true;
    busy = false;
    error = '';
    render();
    try {
      const [nextHealth, nextModels, nextConversations] = await Promise.all([
        api.getHealth(signal),
        api.getModelConnections(signal),
        api.getConversations(0, signal),
      ]);
      if (signal.aborted) return;
      health = nextHealth;
      models = nextModels.filter((m) => m.enabled);
      if (!models.some((m) => m.model_id === selectedModel)) {
        selectedModel = models[0]?.model_id || '';
        generationMode = currentModel()?.generation_mode || 'text2video';
      }
      const model = currentModel();
      if (model?.supported_modes.length && !model.supported_modes.includes(generationMode))
        generationMode = model.generation_mode;
      conversations = nextConversations;
      more = conversations.length === 40;
      if (!conversationId) conversationId = conversations[0]?.id || '';
      const nextMessages = conversationId
        ? await api.getConversationRuns(conversationId, signal)
        : [];
      if (!signal.aborted) messages = nextMessages;
    } catch (caught) {
      if (!signal.aborted) setError(caught);
    } finally {
      if (!signal.aborted) {
        loading = false;
        render();
        schedulePoll();
      }
    }
  }
  function close() {
    open = false;
    controller?.abort();
    clearTimeout(pollTimer);
    loading = false;
    busy = false;
    render();
    const launcher = root.querySelector('button[data-runtime="toggle"]');
    if (launcher instanceof HTMLButtonElement) launcher.focus();
  }
  root.addEventListener('input', (event) => {
    if (event.target instanceof HTMLTextAreaElement) draft = event.target.value;
  });
  root.addEventListener('change', (event) => {
    if (event.target instanceof HTMLSelectElement && event.target.name === 'model') {
      selectedModel = event.target.value;
      generationMode = currentModel()?.generation_mode || 'text2video';
      error = '';
      render();
    }
    if (event.target instanceof HTMLSelectElement && event.target.name === 'generation_mode') {
      generationMode = /** @type {import('../types').GenerationMode} */ (event.target.value);
      render();
    }
    if (event.target instanceof HTMLInputElement && event.target.matches('[data-runtime-files]'))
      void upload(Array.from(event.target.files || []));
  });
  root.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (busy || loading || activeRun() || !selectedModel || !draft.trim()) return;
    const signal = begin();
    busy = true;
    error = '';
    render();
    try {
      if (!conversationId) {
        const conversation = await api.createConversation(signal);
        if (signal.aborted) return;
        conversationId = conversation.id;
        conversations.unshift(conversation);
      }
      const run = await api.createRun(
        draft.trim(),
        selectedModel,
        conversationId,
        signal,
        attachments.map((asset) => asset.id),
        currentModel()?.supported_modes.length ? generationMode : undefined,
      );
      if (signal.aborted) return;
      update(run);
      const current = conversations.find((c) => c.id === conversationId);
      if (current?.title === '新对话') current.title = draft.trim().slice(0, 48);
      draft = '';
      attachments = [];
    } catch (caught) {
      if (!signal.aborted) {
        setError(caught);
        if (conversationId) {
          try {
            const next = await api.getConversationRuns(conversationId, signal);
            if (!signal.aborted) messages = next;
          } catch {
            /* 保留提交错误与草稿，下次刷新可恢复服务端记录。 */
          }
        }
      }
    } finally {
      if (!signal.aborted) {
        busy = false;
        render();
        schedulePoll();
      }
    }
  });
  root.addEventListener('click', async (event) => {
    if (!(event.target instanceof Element)) return;
    if (event.target.closest('[data-runtime-link="configure"]')) {
      close();
      return;
    }
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
      return;
    }
    if (action === 'history') {
      historyOpen = !historyOpen;
      render();
      return;
    }
    if (action === 'suggest') {
      draft = '如何设计一次公平的多模态模型对比？';
      render();
      return;
    }
    if (busy || loading) return;
    if (action === 'remove-media' && !activeRun()) {
      attachments = attachments.filter((asset) => asset.id !== button.dataset.mediaId);
      render();
      return;
    }
    if (action === 'new') {
      begin();
      conversationId = '';
      messages = [];
      attachments = [];
      draft = '';
      error = '';
      historyOpen = false;
      render();
      return;
    }
    if (action === 'refresh') {
      await load();
      return;
    }
    if (action === 'experiment' && button.dataset.runId) {
      const id = button.dataset.runId;
      close();
      window.dispatchEvent(new CustomEvent('prism:record-experiment', { detail: id }));
      return;
    }
    const signal = begin();
    busy = true;
    error = '';
    render();
    try {
      if (action === 'select' && button.dataset.conversationId) {
        const next = await api.getConversationRuns(button.dataset.conversationId, signal);
        if (signal.aborted) return;
        conversationId = button.dataset.conversationId;
        messages = next;
        attachments = [];
        draft = '';
        historyOpen = false;
      }
      if (action === 'more') {
        const next = await api.getConversations(conversations.length, signal);
        if (signal.aborted) return;
        for (const item of next)
          if (!conversations.some((c) => c.id === item.id)) conversations.push(item);
        more = next.length === 40;
      }
      if (action === 'cancel' && button.dataset.runId) {
        const run = await api.cancelRun(button.dataset.runId, signal);
        if (!signal.aborted) update(run);
      }
      if (action === 'trace' && button.dataset.runId) {
        const run = await api.verifyTrace(button.dataset.runId, signal);
        if (!signal.aborted) update(run);
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
  root.addEventListener('dragover', (event) => {
    if (open && event.dataTransfer?.types.includes('Files')) {
      event.preventDefault();
      root.classList.add('media-dragover');
    }
  });
  root.addEventListener('dragleave', (event) => {
    if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget))
      root.classList.remove('media-dragover');
  });
  root.addEventListener('drop', (event) => {
    if (!open) return;
    event.preventDefault();
    root.classList.remove('media-dragover');
    void upload(Array.from(event.dataTransfer?.files || []));
  });
  root.addEventListener('paste', (event) => {
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length) {
      event.preventDefault();
      void upload(files);
    }
  });
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      close();
    }
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.isComposing &&
      event.target instanceof HTMLTextAreaElement
    ) {
      event.preventDefault();
      event.target.form?.requestSubmit();
    }
  });
  window.addEventListener('prism:model-connections-changed', () => {
    if (open) void load();
  });
  window.addEventListener('pagehide', () => {
    controller?.abort();
    clearTimeout(pollTimer);
  });
  render();
}
