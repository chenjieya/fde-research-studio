import { escapeHtml as esc, safeUrl } from '../lib/workspace.js';

/** @type {Record<import('../types').GenerationMode, string>} */
export const generationLabels = {
  text2image: '文生图',
  image2image: '参考图生成 / 编辑',
  text2video: '文生视频',
  image2video: '首帧 / 首尾帧生视频',
  video2video: '视频编辑',
};

/** @param {string} label @param {string} name @param {string | number} value @param {string} [attrs] */
function field(label, name, value, attrs = '') {
  return `<label class="field"><span>${esc(label)}</span><input name="${name}" value="${esc(value)}" ${attrs}></label>`;
}
/** @param {string} label @param {string} name @param {string[]} values @param {string} value */
function select(label, name, values, value) {
  return `<label class="field"><span>${esc(label)}</span><select name="${name}">${values.map((v) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
}

/** 从档案名称提出默认服务；保存过的接入始终优先。 @param {string} name */
export function suggestedProvider(name) {
  if (/cosmos/i.test(name)) return 'nvidia_cosmos';
  if (/seedance/i.test(name)) return 'seedance';
  if (/wan\d|万相/i.test(name)) return 'wan';
  if (/gpt.?image/i.test(name)) return 'openai_image';
  if (/qwen.?image/i.test(name)) return 'qwen_image';
  if (/krea/i.test(name)) return 'krea';
  if (/moss.?image/i.test(name)) return 'moss_image';
  if (/h3.?image/i.test(name)) return 'minimax_image';
  if (/qwen|千问/i.test(name)) return 'qwen';
  return 'openai';
}

/** 官方目录由后端统一提供，界面只展示对应任务的参数。
 * @param {import('../types').ModelConnection | undefined} c
 * @param {import('../types').ProviderDefinition[]} providers
 * @param {string} name
 */
export function connectionFields(c, providers, name) {
  const provider =
    providers.find((p) => p.id === (c?.provider || suggestedProvider(name))) || providers[0];
  if (!provider) throw new Error('服务端未提供接入目录。');
  const g = c?.generation;
  const dimension = 'type="number" step="1" required';
  return `<div class="connection-intro"><span class="eyebrow">MODEL CONNECTION</span><p>选择官方服务，系统会处理接口差异。分析与生成都在运行工作室完成。</p></div>
    <div class="form-grid"><label class="field"><span>官方服务 / 用途</span><select name="provider">${providers.map((p) => `<option value="${esc(p.id)}" ${p.id === provider.id ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}</select></label>${field('API 模型名 / 接入点 ID *', 'api_model', c?.api_model || provider.api_model, 'required maxlength="200" placeholder="从厂商控制台复制模型标识"')}</div>
    <p class="form-hint" data-provider-hint></p>
    ${field('服务地址 *', 'base_url', c?.base_url || provider.base_url, 'required type="url" maxlength="2000"')}
    <p class="form-hint"><a data-provider-doc target="_blank" rel="noopener noreferrer">查看官方接口说明 ↗</a></p>
    ${field(c?.api_key_configured ? 'API Key（已保存，留空保留）' : 'API Key', 'api_key', '', 'type="password" autocomplete="new-password" maxlength="8192"')}
    ${c?.api_key_configured ? '<label class="acknowledge"><input type="checkbox" name="clear_api_key">清除已保存的 API Key</label>' : ''}
    <fieldset class="connection-capabilities" data-chat-fields><legend>分析输入</legend><label><input type="checkbox" name="input_image" ${!c || c.input_modalities.includes('image') ? 'checked' : ''}>图片</label><label><input type="checkbox" name="input_video" ${c?.input_modalities.includes('video') || (!c && provider.id === 'qwen') ? 'checked' : ''}>视频</label><p class="form-hint">按具体模型能力勾选。视频使用 video_url；Qwen VL 可分析视频，生成模型不用于分析视频。</p></fieldset>
    <fieldset class="connection-generation" data-generation-fields><legend>生成设置</legend><label class="field"><span>默认任务</span><select name="generation_mode" data-current-mode="${esc(c?.generation_mode || provider.modes[0] || 'text2video')}"></select></label>
    <div class="form-grid" data-option-group="image">${field('图片尺寸（宽x高）', 'image_size', g?.image_size || '1024x1024', 'required pattern="auto|[0-9]{3,4}x[0-9]{3,4}" placeholder="1024x1024 或 auto"')}<p class="form-hint">例如 1024x1024、1536x1024。GPT Image 1.5 支持 1024x1024、1536x1024、1024x1536、auto；不同版本以官方限制为准。</p></div>
    <div data-option-group="quality">${select('图片质量', 'quality', ['auto', 'low', 'medium', 'high'], g?.quality || 'auto')}</div>
    <div class="form-grid" data-option-group="video">${select('视频分辨率', 'video_resolution', ['480p', '720p', '1080p'], g?.video_resolution || '720p')}${field('视频时长（秒）', 'duration', g?.duration ?? 5, dimension + ' min="2" max="30"')}<label class="acknowledge"><input type="checkbox" name="audio" ${g?.audio !== false ? 'checked' : ''}>生成声音（需模型支持）</label></div>
    <div data-option-group="ratio">${select('画面比例', 'aspect_ratio', ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'], g?.aspect_ratio || '16:9')}</div>
    <div data-option-group="krea">${select('创意程度 · Krea', 'creativity', ['raw', 'low', 'medium', 'high'], g?.creativity || 'medium')}<p class="form-hint">Krea 2 输出 1K。参考图生成使用单张源图，变化强度为 0.75。</p></div>
    <div class="form-grid" data-option-group="cosmos">${select('分辨率与画幅 · Cosmos', 'resolution', ['256_16_9', '256_1_1', '256_9_16', '480_16_9', '480_1_1', '480_9_16', '720_16_9', '720_1_1', '720_9_16'], g?.resolution || '480_16_9')}${field('视频帧数', 'num_frames', g?.num_frames ?? 25, dimension + ' min="25" max="197"')}${field('帧率', 'fps', g?.fps ?? 24, dimension + ' min="1" max="60"')}</div>
    <div data-option-group="steps">${field('采样步数', 'num_inference_steps', g?.num_inference_steps ?? 35, dimension + ' min="1" max="100"')}</div>
    <div data-option-group="seed">${field('随机种子（可选）', 'seed', g?.seed ?? '', 'type="number" min="0" max="2147483647" step="1"')}</div>
    <div data-option-group="negative">${field('不希望出现的内容（可选）', 'negative_prompt', g?.negative_prompt || '', 'maxlength="4000"')}</div></fieldset>
    <div data-chat-only><label class="field"><span>系统提示词</span><textarea name="system_prompt" maxlength="20000" rows="4">${esc(c?.system_prompt ?? '你是严谨的多模态模型研究助手。区分事实、推断与待验证问题。')}</textarea></label><div class="form-grid">${field('温度（可选）', 'temperature', c?.temperature ?? '', 'type="number" min="0" max="2" step="any"')}${field('最大输出 Token', 'max_tokens', c?.max_tokens ?? 2048, dimension + ' min="1" max="131072"')}</div></div>
    <div data-qwen-thinking><label class="field"><span>Qwen 思考模式</span><select name="qwen_thinking"><option value="off" ${!c || c.qwen_thinking === 'off' ? 'selected' : ''}>关闭 · 直接分析</option><option value="on" ${c?.qwen_thinking === 'on' ? 'selected' : ''}>开启 · 深度思考</option><option value="default" ${c?.qwen_thinking === 'default' ? 'selected' : ''}>使用模型默认</option></select></label><p class="form-hint">适用于支持开关的百炼 Qwen 模型。默认关闭，避免普通图片、视频分析长时间等待；研究推理能力时可开启，并调大等待超时。请求会使用流式传输，完成后展示整段结果。</p></div>
    ${field('等待超时（秒）', 'timeout_seconds', c?.timeout_seconds ?? provider.timeout_seconds, dimension + ' min="5" max="3600"')}
    <label class="acknowledge"><input type="checkbox" name="enabled" ${c?.enabled !== false ? 'checked' : ''}>在运行工作室启用此模型</label><input type="hidden" name="expected_revision" value="${c?.revision ?? 0}"><p class="form-hint">保存配置不会调用模型。生成任务仅使用本轮提示词和素材；密钥加密保存在服务端。</p>`;
}

/** 参数分组与厂商适配对应；隐藏的无关参数不参与表单校验。
 * @param {HTMLFormElement} form @param {import('../types').ProviderDefinition[]} providers
 */
export function bindConnectionForm(form, providers) {
  let previous = providers.find((p) => p.id === new FormData(form).get('provider'));
  const refresh = (defaults = false) => {
    const fields = new FormData(form);
    const provider = providers.find((p) => p.id === fields.get('provider'));
    if (!provider) return;
    const generated = provider.modes.length > 0;
    /** @param {string} name @param {string} value */
    const assign = (name, value) => {
      const node = form.elements.namedItem(name);
      if (node instanceof HTMLInputElement) node.value = value;
    };
    if (defaults) {
      const base = String(fields.get('base_url') || '');
      const sameAlibaba =
        ['qwen', 'qwen_image', 'wan'].includes(provider.id) &&
        ['qwen', 'qwen_image', 'wan'].includes(previous?.id || '');
      if (!sameAlibaba || !base) assign('base_url', provider.base_url);
      assign('api_model', provider.api_model);
      assign('timeout_seconds', String(provider.timeout_seconds));
    }
    const hint = form.querySelector('[data-provider-hint]');
    if (hint) hint.textContent = provider.hint;
    const doc = form.querySelector('[data-provider-doc]');
    if (doc instanceof HTMLAnchorElement) doc.href = safeUrl(provider.documentation);
    /** @param {string} selector @param {boolean} show */
    const toggle = (selector, show) => {
      for (const node of form.querySelectorAll(selector))
        if (node instanceof HTMLElement) {
          node.hidden = !show;
          for (const control of node.querySelectorAll('input, select, textarea'))
            if (
              control instanceof HTMLInputElement ||
              control instanceof HTMLSelectElement ||
              control instanceof HTMLTextAreaElement
            )
              control.disabled = !show;
        }
    };
    toggle('[data-chat-fields], [data-chat-only]', !generated);
    toggle('[data-generation-fields]', generated);
    let baseHost = '';
    try {
      baseHost = new URL(String(fields.get('base_url') || '')).hostname;
    } catch {
      // 编辑中的地址仍由表单和后端校验，不阻断其他配置项。
    }
    const officialQwen =
      provider.id === 'qwen' ||
      baseHost === 'dashscope.aliyuncs.com' ||
      baseHost.endsWith('.maas.aliyuncs.com');
    toggle(
      '[data-qwen-thinking]',
      !generated &&
        officialQwen &&
        ['openai', 'qwen'].includes(provider.id) &&
        /^qwen(?:3\.8-(?:max|flash)|3\.7-plus|3\.6-plus|3\.5-(?:plus|flash)|3-vl-(?:plus|flash))/i.test(
          String(fields.get('api_model') || ''),
        ),
    );
    const groups = {
      image: ['openai_image', 'qwen_image', 'moss_image', 'minimax_image'],
      quality: ['openai_image'],
      video: ['seedance', 'wan'],
      ratio: ['seedance', 'wan', 'krea'],
      krea: ['krea'],
      cosmos: ['nvidia_cosmos'],
      steps: ['nvidia_cosmos', 'moss_image'],
      seed: ['nvidia_cosmos', 'qwen_image', 'moss_image', 'seedance', 'wan', 'krea'],
      negative: ['qwen_image', 'moss_image'],
    };
    for (const [group, values] of Object.entries(groups))
      toggle(`[data-option-group="${group}"]`, values.includes(provider.id));
    const video = form.elements.namedItem('input_video');
    if (video instanceof HTMLInputElement) {
      video.disabled = generated || provider.id === 'anthropic';
      if (provider.id === 'anthropic') video.checked = false;
      if (defaults && provider.id === 'qwen') video.checked = true;
    }
    const temperature = form.elements.namedItem('temperature');
    if (temperature instanceof HTMLInputElement)
      temperature.max = provider.id === 'anthropic' ? '1' : '2';
    const modes = form.elements.namedItem('generation_mode');
    if (modes instanceof HTMLSelectElement) {
      let supported = provider.modes;
      const name = String(fields.get('api_model') || '').toLowerCase();
      if (provider.id === 'qwen_image')
        supported = name.includes('edit')
          ? ['image2image']
          : /^qwen-image-[23]/.test(name)
            ? supported
            : ['text2image'];
      const value = defaults ? supported[0] : modes.value || modes.dataset.currentMode;
      modes.innerHTML = supported
        .map(
          (mode) =>
            `<option value="${mode}" ${mode === value ? 'selected' : ''}>${generationLabels[mode]}</option>`,
        )
        .join('');
    }
    previous = provider;
  };
  refresh();
  form.addEventListener('change', (event) => {
    if (event.target instanceof HTMLSelectElement && event.target.name === 'provider')
      refresh(true);
    else if (
      event.target instanceof HTMLInputElement &&
      ['api_model', 'base_url'].includes(event.target.name)
    )
      refresh();
  });
}

/** 隐藏参数使用已有值或统一默认值，适配器仅发送相关字段。 @param {HTMLFormElement} form @returns {import('../types').ModelConnectionInput} */
export function readConnectionForm(form) {
  const fields = new FormData(form);
  /** @param {string} name */
  const value = (name) => String(fields.get(name) || '').trim();
  /** @param {string} name @param {number} fallback */
  const number = (name, fallback) => (value(name) ? Number(value(name)) : fallback);
  return {
    provider: /** @type {import('../types').ModelProvider} */ (value('provider')),
    api_model: value('api_model'),
    base_url: value('base_url'),
    api_key: value('api_key'),
    clear_api_key: fields.get('clear_api_key') === 'on',
    enabled: fields.get('enabled') === 'on',
    expected_revision: number('expected_revision', 0),
    input_modalities: [
      ...(fields.get('input_image') === 'on' ? [/** @type {const} */ ('image')] : []),
      ...(fields.get('input_video') === 'on' ? [/** @type {const} */ ('video')] : []),
    ],
    generation_mode: /** @type {import('../types').GenerationMode} */ (
      value('generation_mode') || 'text2video'
    ),
    generation: {
      resolution: value('resolution') || '480_16_9',
      num_frames: number('num_frames', 25),
      num_inference_steps: number('num_inference_steps', 35),
      fps: number('fps', 24),
      seed: value('seed') ? Number(value('seed')) : null,
      image_size: value('image_size') || '1024x1024',
      quality: /** @type {import('../types').GenerationOptions['quality']} */ (
        value('quality') || 'auto'
      ),
      video_resolution: /** @type {import('../types').GenerationOptions['video_resolution']} */ (
        value('video_resolution') || '720p'
      ),
      aspect_ratio: /** @type {import('../types').GenerationOptions['aspect_ratio']} */ (
        value('aspect_ratio') || '16:9'
      ),
      duration: number('duration', 5),
      audio: fields.get('audio') === 'on',
      creativity: /** @type {import('../types').GenerationOptions['creativity']} */ (
        value('creativity') || 'medium'
      ),
      negative_prompt: value('negative_prompt'),
    },
    system_prompt: value('system_prompt'),
    temperature: value('temperature') ? Number(value('temperature')) : null,
    max_tokens: number('max_tokens', 2048),
    timeout_seconds: number('timeout_seconds', 120),
    qwen_thinking: /** @type {import('../types').ModelConnection['qwen_thinking']} */ (
      value('qwen_thinking') || 'off'
    ),
  };
}
