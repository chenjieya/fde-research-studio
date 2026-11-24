// 前端入口：页面导航、记录编辑、备份恢复和交付物操作都从这里接起来。
import {
  emptyWorkspace,
  escapeHtml as esc,
  download,
  safeUrl,
  isWorkspace,
  uid,
  today,
  domains,
  stages,
  kinds,
} from './lib/workspace.js';
import {
  readWorkspace,
  getWorkspace,
  persistWorkspace,
  getLegacyBackup,
  WorkspaceApiError,
} from './lib/workspace-api.js';
import { generateReport, renderMarkdown, reportHtml } from './lib/reports.js';
import { icon, artwork, modelCard } from './components/visuals.js';
import { mountRuntimeConsole } from './components/runtime-console.js';
import * as runtimeApi from './lib/runtime-api.js';
import './chat.css';
import prismLogo from '../assets/prism.svg';

/**
 * 获取页面元素并确认类型，缺少必需元素时尽早报错。
 * @template {Element} T
 * @param {string} selector
 * @param {new (...args: never[]) => T} type
 * @returns {T}
 */
function element(selector, type) {
  const node = document.querySelector(selector);
  if (!(node instanceof type)) throw new Error(`未找到页面元素：${selector}`);
  return node;
}
const app = element('#app', HTMLDivElement);
const modal = element('#modal', HTMLDialogElement);
const toastNode = element('#toast', HTMLDivElement);
const fileInput = element('#import-file', HTMLInputElement);
let data = emptyWorkspace();
let revision = 0;
let storageError = '';
let workspaceLoading = true;
let saving = false;
/** @type {import('./types').Page[]} */
const pages = ['overview', 'models', 'experiments', 'frontier', 'deliverables'];
const labels = {
  overview: '研究总览',
  models: '模型档案',
  experiments: '实验对比',
  frontier: '前沿追踪',
  deliverables: '交付工作室',
};
/** @type {import('./types').Page} */
let page = 'overview';
let domainFilter = '全部';
let capabilityFilter = '全部能力';
let stageFilter = '全部状态';
let query = '';
let favoritesOnly = false;
let mobileNav = false;
/** @type {string[]} */
let comparedIds = [];
/** @type {ReturnType<typeof setTimeout> | undefined} */
let toastTimer;
/**
 * 显示短提示，连续提示时先取消上一次隐藏计时。
 * @param {string} message
 */
function toast(message) {
  clearTimeout(toastTimer);
  toastNode.textContent = message;
  toastNode.classList.add('show');
  toastTimer = setTimeout(() => toastNode.classList.remove('show'), 3500);
}
/**
 * 先把修改写入数据库，成功后再更新页面，失败时保留编辑内容。
 * @param {(next: import('./types').Workspace) => void} update
 */
async function commit(update) {
  if (storageError || workspaceLoading) {
    toast('请先成功加载线上记录，再进行保存。');
    return false;
  }
  if (saving) {
    toast('正在保存，请稍候。');
    return false;
  }
  const next = structuredClone(data);
  update(next);
  saving = true;
  const controls = [
    ...document.querySelectorAll(
      'button[type="submit"], button[data-action="save-artifact"], button[data-action="favorite"], select[data-note-stage]',
    ),
  ].filter((node) => node instanceof HTMLButtonElement || node instanceof HTMLSelectElement);
  const previous = controls.map((control) => control.disabled);
  controls.forEach((control) => {
    control.disabled = true;
  });
  const status = document.querySelector('.local-status span');
  if (status) status.textContent = '正在保存到云端…';
  try {
    const snapshot = await persistWorkspace(next, revision);
    data = snapshot.data;
    revision = snapshot.revision;
    return true;
  } catch (error) {
    if (error instanceof WorkspaceApiError && error.status === 409) {
      try {
        const latest = await getWorkspace();
        data = latest.data;
        revision = latest.revision;
        shell();
      } catch {
        /* 保留旧版本，后续保存仍会被服务端版本校验拦截。 */
      }
    }
    toast(error instanceof Error ? error.message : '保存失败，请检查服务后重试。');
    return false;
  } finally {
    saving = false;
    controls.forEach((control, index) => {
      control.disabled = previous[index];
    });
    const status = document.querySelector('.local-status span');
    if (status) status.textContent = '记录保存在云端数据库';
  }
}

/** 读取线上记录，并处理旧浏览器记录的首次迁移。 */
async function loadWorkspace() {
  workspaceLoading = true;
  storageError = '';
  shell();
  try {
    const current = await getWorkspace();
    data = current.data;
    revision = current.revision;
    const snapshot = await readWorkspace();
    data = snapshot.data;
    revision = snapshot.revision;
  } catch (error) {
    storageError = error instanceof Error ? error.message : '研究空间加载失败，请重试。';
  } finally {
    workspaceLoading = false;
    shell();
  }
}
/** @param {string} value */
const buttonClose = (value) =>
  `<button type="button" class="icon-button" data-action="close" aria-label="关闭${value}">${icon('close')}</button>`;
/** @param {string} title @param {string} subtitle @param {string} action */
const pageHeading = (title, subtitle, action) =>
  `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
/** @param {string} title @param {string} description @param {string} [action] */
const emptyState = (title, description, action = '') =>
  `<div class="empty-state">${icon('book')}<h3>${title}</h3><p>${description}</p>${action}</div>`;
/** @param {string} source */
const sourceLink = (source) =>
  safeUrl(source)
    ? `<a class="source-link" href="${esc(safeUrl(source))}" target="_blank" rel="noopener noreferrer">查看原始来源 ${icon('external')}</a>`
    : '<span class="muted">尚未登记来源</span>';
/** @param {string} stage */
const stageBadge = (stage) => `<span class="stage stage-${esc(stage)}">${esc(stage)}</span>`;
/** @param {string} value @param {string} label @param {string} [selected] */
const option = (value, label, selected = '') =>
  `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(label)}</option>`;

/** 重绘工作台主区域；弹窗和运行窗口独立保留。 */
function shell() {
  const counts = {
    overview: '',
    models: data.models.length,
    experiments: data.experiments.length,
    frontier: data.notes.length,
    deliverables: data.artifacts.length || '',
  };
  app.innerHTML = `<div class="workspace ${mobileNav ? 'nav-open' : ''}"><aside class="sidebar"><a class="brand" href="#overview"><img src="${esc(prismLogo)}" alt="" width="35" height="35"><span>Prism<span class="brand-caption">多模态研究工作台</span></span></a><div class="workspace-label"><span class="workspace-dot">F</span><span>FDE 研究空间</span><span class="personal">个人版</span></div><nav aria-label="工作台导航">${pages.map((key) => `<a href="#${key}" class="nav-item ${page === key ? 'active' : ''}" ${page === key ? 'aria-current="page"' : ''}>${icon(key)}<span>${labels[key]}</span><span class="nav-count">${counts[key]}</span></a>`).join('')}</nav><div class="sidebar-topics"><p class="sidebar-caption">研究方向</p>${domains.map((d, i) => `<button data-action="domain-nav" data-id="${d}" class="topic-nav"><span class="topic-dot topic-${i}"></span>${d === '图片' ? '图像与视觉' : d === 'CAD' ? 'CAD 与空间' : d === '视频' ? '视频与世界模型' : '语言文本'}<span>${data.models.filter((m) => m.domain === d).length}</span></button>`).join('')}</div><div class="sidebar-bottom"><div class="local-status">${icon('check')}<span>记录保存在云端数据库</span></div><div class="backup-actions"><button data-action="backup">${icon('download')}备份</button><button data-action="import">${icon('upload')}恢复</button></div><div class="profile"><span class="avatar">陈</span><div><strong>我的研究空间</strong><span>发现 · 验证 · 交付</span></div><button class="icon-button" data-action="about" aria-label="关于工作台">${icon('info')}</button></div></div></aside><div class="main-shell"><header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="menu" aria-label="打开导航">${icon('menu')}</button><span>工作空间</span>${icon('chevron')}<strong>${labels[page]}</strong></div><div class="top-actions"><button class="global-search" data-action="search">${icon('search')}<span>搜索研究内容</span><kbd>Ctrl K</kbd></button><span class="prototype-label">在线研究空间</span><span class="small-avatar">陈</span></div></header><main id="main" tabindex="-1">${storageError ? `<div class="error-banner" role="alert">${esc(storageError)}<button data-action="retry-workspace">重新连接</button><button data-action="raw-backup">导出原始记录</button><button data-action="import">恢复备份</button></div>` : ''}${workspaceLoading ? '<section class="empty-state" role="status"><h3>正在连接研究空间…</h3><p>读取线上记录，并检查旧浏览器数据迁移。</p></section>' : storageError ? emptyState('研究空间暂不可用', '请重新连接；旧浏览器数据会在迁移成功后才清理。') : content()}</main><footer class="workspace-footer"><span>Prism Research Studio</span><span>研究记录保存在云端；模型可在档案中配置，实验结论由你确认。</span></footer></div></div>`;
}
/** 根据当前导航选择对应页面。 */
function content() {
  if (page === 'models') return modelsPage();
  if (page === 'experiments') return experimentsPage();
  if (page === 'frontier') return frontierPage();
  if (page === 'deliverables') return deliverablesPage();
  return overviewPage();
}
/** 汇总已有模型、实验和手记，不另外生成研究成绩。 */
function overviewPage() {
  const focus = data.models.find((m) => m.id === 'neural-cad') ?? data.models[0];
  const featured = domains
    .map((d) => data.models.find((m) => m.domain === d))
    .filter((m) => m !== undefined);
  return `${pageHeading('每一次探索，都有所沉淀。', '连接前沿技术、实验发现与下一份交付。', `<button class="button primary" data-action="new-model">${icon('plus')}记录模型</button>`)}<div class="overview-layout"><div class="overview-main"><section class="focus-banner"><div class="focus-copy"><span class="focus-tag">${icon('spark')}本周研究焦点</span><h2>从设计意图，<br>到可编辑的几何。</h2><p>探索 CAD 生成的下一步：<br>精度、约束，以及真正可用的设计。</p><button class="button hero-button" data-action="${focus ? 'detail' : 'new-model'}" ${focus ? `data-id="${esc(focus.id)}"` : ''}>${focus ? '继续研究' : '开始记录'}${icon('book')}</button></div><div class="focus-visual">${artwork('CAD', true)}<span class="visual-caption">Geometry study / CAD</span></div><span class="focus-issue">研究专题 · CAD</span></section><div class="section-heading"><div><h2>能力探索</h2><span>${domains.length} 个方向，持续深入</span></div><a href="#models">全部模型 ${icon('chevron')}</a></div><div class="model-grid overview-models">${featured.map(modelCard).join('') || emptyState('开始建立模型档案', '记录第一个值得研究的模型。')}</div><div class="section-heading recent-heading"><div><h2>最近的实验</h2><span>让每一个判断都有依据</span></div><a href="#experiments">实验记录 ${icon('chevron')}</a></div><section class="recent-list">${
    data.experiments
      .slice(0, 3)
      .map(
        (e) =>
          `<button class="recent-experiment" data-action="experiment-detail" data-id="${esc(e.id)}"><span class="experiment-icon">${icon('experiments')}</span><span class="recent-copy"><strong>${esc(e.title)}${e.demo ? '<span class="demo-label">演示</span>' : ''}</strong><span>${esc(data.models.find((m) => m.id === e.modelId)?.name ?? '')} · ${esc(e.task)}</span></span><span class="recent-date">${esc(e.date.slice(5))}</span>${icon('chevron')}</button>`,
      )
      .join('') || emptyState('还没有实验', '从真实样本和明确的成功标准开始。')
  }</section></div><aside class="research-aside"><section class="research-pulse"><div class="section-heading compact"><h2>研究脉搏</h2><span class="today-label">${today().slice(5).replace('-', ' / ')}</span></div><div class="pulse-row"><span>已收录模型</span><strong>${String(data.models.length).padStart(2, '0')}<small>个</small></strong></div><div class="pulse-row"><span>实验记录</span><strong>${String(data.experiments.length).padStart(2, '0')}<small>次</small></strong></div><div class="pulse-row"><span>交付成果</span><strong>${String(data.artifacts.length).padStart(2, '0')}<small>份</small></strong></div><div class="domain-spectrum">${domains.map((d, i) => `<span class="spectrum-${i}" style="flex:${Math.max(1, data.models.filter((m) => m.domain === d).length)}"></span>`).join('')}</div><div class="spectrum-legend">${domains.map((d) => `<span>${d}</span>`).join('')}</div></section><section class="field-notes"><div class="section-heading compact"><h2>前沿手记</h2><button class="icon-button" data-action="new-note" aria-label="新增前沿手记">${icon('plus')}</button></div>${
    data.notes
      .slice(0, 3)
      .map(
        (n) =>
          `<button class="note-snippet" data-action="note-detail" data-id="${esc(n.id)}"><span class="note-domain">${n.domain} / ${esc(n.stage)}</span><strong>${esc(n.title)}</strong><span class="note-date">${esc(n.date.slice(5))}</span></button>`,
      )
      .join('') || '<p class="muted">把值得追踪的问题记在这里。</p>'
  }<a class="all-notes" href="#frontier">打开前沿追踪 ${icon('chevron')}</a></section><section class="deliver-prompt"><span class="paper-symbol">${icon('deliverables')}</span><h3>让研究成为交付。</h3><p>把模型档案与实验结论，<br>整理成一份清晰的报告。</p><button class="button" data-action="new-report">创建交付物${icon('plus')}</button></section></aside></div>`;
}
/** 把领域、能力、状态、关注和搜索条件一起应用到模型列表。 */
function filteredModels() {
  const term = query.trim().toLowerCase();
  return data.models.filter(
    (m) =>
      (domainFilter === '全部' || m.domain === domainFilter) &&
      (capabilityFilter === '全部能力' || m.capabilities.includes(capabilityFilter)) &&
      (stageFilter === '全部状态' || m.stage === stageFilter) &&
      (!favoritesOnly || m.favorite) &&
      (!term ||
        [m.name, m.vendor, m.summary, m.route, m.notes].join(' ').toLowerCase().includes(term)),
  );
}
/** 显示模型档案和筛选控件。 */
function modelsPage() {
  return `${pageHeading('模型档案', '把模型能力、技术路线与验证边界，记录在同一个地方。', `<button class="button primary" data-action="new-model">${icon('plus')}记录模型</button>`)}<div class="filter-bar"><div class="domain-tabs" role="group" aria-label="按研究领域筛选">${['全部', ...domains].map((d) => `<button class="${domainFilter === d ? 'selected' : ''}" data-action="filter-domain" data-id="${d}" aria-pressed="${domainFilter === d}">${d}<span>${d === '全部' ? data.models.length : data.models.filter((m) => m.domain === d).length}</span></button>`).join('')}</div><button class="button subtle ${favoritesOnly ? 'selected' : ''}" data-action="favorites" aria-pressed="${favoritesOnly}">${icon('star')}仅看关注</button></div><div class="list-tools"><label class="inline-search">${icon('search')}<input id="model-query" type="search" placeholder="搜索名称、厂商或技术路线" value="${esc(query)}" aria-label="筛选模型"></label><label class="select-label"><span class="sr-only">能力类型</span><select id="capability-filter">${['全部能力', '生成编辑', '识别理解'].map((v) => option(v, v, capabilityFilter)).join('')}</select></label><label class="select-label"><span class="sr-only">研究状态</span><select id="stage-filter">${['全部状态', ...stages].map((v) => option(v, v, stageFilter)).join('')}</select></label><span class="result-count" id="model-count">${filteredModels().length} 个模型</span></div><div id="model-results" class="model-grid library-grid">${modelResults()}</div>`;
}
/** 生成筛选后的模型卡片，没有结果时显示空状态。 */
function modelResults() {
  return (
    filteredModels().map(modelCard).join('') ||
    emptyState(
      '没有找到相关模型',
      '试试其他关键词，或清除筛选条件。',
      '<button class="button" data-action="clear-filters">清除筛选</button>',
    )
  );
}
/** 展示已有实验，明确区分演示数据和用户记录。 */
function experimentsPage() {
  const displayed = comparedIds.length
    ? data.experiments.filter((e) => comparedIds.includes(e.modelId))
    : data.experiments;
  return `${pageHeading('让结论，经得起验证。', '记录样本、结果与失败案例。不同测试条件下的成绩不直接排名。', `<button class="button primary" data-action="new-experiment">${icon('plus')}记录实验</button>`)}<section class="comparison-strip"><div><span class="round-icon">${icon('models')}</span><div><h2>建立你的比较视角</h2><p>选择模型，查看它们已有的实验依据。</p></div></div><div class="compare-picks">${data.models.map((m) => `<button class="model-chip ${comparedIds.includes(m.id) ? 'selected' : ''}" data-action="compare-model" data-id="${esc(m.id)}" aria-pressed="${comparedIds.includes(m.id)}">${comparedIds.includes(m.id) ? icon('check') : icon('plus')}${esc(m.name)}</button>`).join('')}</div></section><div class="section-heading"><h2>实验日志 <span class="muted count-inline">${displayed.length}</span></h2><button class="button subtle" data-action="new-report" data-kind="模型对比报告">${icon('deliverables')}生成对比报告</button></div><div class="experiment-grid">${
    displayed
      .map((e) => {
        const m = data.models.find((m) => m.id === e.modelId);
        return `<article class="experiment-card"><div class="experiment-card-top"><span class="domain-label">${esc(m?.domain ?? '')} · ${esc(e.task)}</span>${e.demo ? '<span class="demo-label">虚构演示</span>' : '<span class="user-label">用户记录</span>'}</div><button class="title-button" data-action="experiment-detail" data-id="${esc(e.id)}">${esc(e.title)}</button><p class="experiment-model">${esc(m?.name ?? '')} <span>${esc(e.date)}</span></p><div class="experiment-metrics"><div><strong>${((e.successCount / e.sampleSize) * 100).toFixed(0)}<small>%</small></strong><span>按记录标准的成功率</span></div><div><strong>${e.sampleSize}<small>份</small></strong><span>样本数量</span></div><div><strong>${e.latency ?? '—'}<small>${e.latency === null ? '' : 's'}</small></strong><span>单次耗时</span></div></div><p class="experiment-conclusion">${esc(e.conclusion)}</p><div class="experiment-card-bottom"><span>${esc(e.dataset)}</span><button class="text-button" data-action="experiment-detail" data-id="${esc(e.id)}">查看记录 ${icon('chevron')}</button></div></article>`;
      })
      .join('') ||
    emptyState(
      '还没有相关实验记录',
      '选择一个模型，录入你实际执行过的验证结果。',
      '<button class="button" data-action="new-experiment">记录实验</button>',
    )
  }</div>`;
}
/** 把研究手记按进展状态放到看板中。 */
function frontierPage() {
  return `${pageHeading('追踪变化，也记录思考。', '让论文、技术动态与待验证的问题，沿着研究进程持续推进。', `<button class="button primary" data-action="new-note">${icon('plus')}新增研究手记</button>`)}<div class="frontier-banner">${icon('frontier')}<div><strong>从值得关注，到值得投入</strong><p>每条手记保留原始来源与下一步问题。这里的状态由你判断和维护。</p></div></div><div class="kanban">${stages
    .map(
      (s) =>
        `<section class="kanban-column"><div class="kanban-heading"><h2>${s}</h2><span>${data.notes.filter((n) => n.stage === s).length}</span></div>${
          data.notes
            .filter((n) => n.stage === s)
            .map(
              (n) =>
                `<article class="research-note"><span class="domain-label">${n.domain}</span><button class="title-button" data-action="note-detail" data-id="${esc(n.id)}">${esc(n.title)}</button><p>${esc(n.body)}</p><div class="note-card-bottom"><span>${esc(n.date.slice(5))}${n.demo ? ' · 示例' : ''}</span><button class="icon-button" data-action="edit-note" data-id="${esc(n.id)}" aria-label="编辑 ${esc(n.title)}">${icon('edit')}</button></div><label class="note-stage"><span class="sr-only">${esc(n.title)}的状态</span><select data-note-stage="${esc(n.id)}">${stages.map((v) => option(v, v, s)).join('')}</select></label></article>`,
            )
            .join('') || '<div class="kanban-empty">等待下一条发现</div>'
        }</section>`,
    )
    .join('')}</div>`;
}
/** 展示报告模板和已保存的交付物。 */
function deliverablesPage() {
  return `${pageHeading('研究的下一站，是交付。', '从已有记录整理草稿，保留来源、证据与尚待确认的部分。', `<button class="button primary" data-action="new-report">${icon('plus')}创建交付物</button>`)}<div class="template-grid">${kinds.map((k, i) => `<button class="template-card template-${i}" data-action="new-report" data-kind="${k}"><span class="template-icon">${icon(['book', 'models', 'deliverables', 'frontier'][i])}</span><h2>${k}</h2><p>${['整理本期进展、实验发现与下周计划', '汇总候选模型与可比的实验依据', '把技术能力连接到客户的业务流程', '梳理技术路线、资料来源与开放问题'][i]}</p><span class="template-use">使用模板 ${icon('plus')}</span></button>`).join('')}</div><div class="section-heading"><h2>我的交付物 <span class="muted count-inline">${data.artifacts.length}</span></h2><span class="muted">可编辑 · Markdown / HTML · 打印为 PDF</span></div><div class="artifact-list">${data.artifacts.length ? data.artifacts.map((a) => `<article class="artifact-row"><span class="artifact-icon">${icon('deliverables')}</span><div><button class="title-button" data-action="artifact" data-id="${esc(a.id)}">${esc(a.title)}</button><p>${esc(a.kind)} · ${a.modelIds.length} 个模型 · ${esc(a.date)}</p></div><span class="stage stage-研究中">待复核草稿</span><button class="button" data-action="artifact" data-id="${esc(a.id)}">打开文档${icon('edit')}</button><button class="icon-button" data-action="export-md" data-id="${esc(a.id)}" aria-label="导出 ${esc(a.title)}">${icon('download')}</button></article>`).join('') : emptyState('你的第一份交付物，从这里开始。', '选择上方模板，将模型档案和实验结果整理成可编辑的草稿。')}</div><div class="delivery-note">${icon('info')}草稿使用本地模板整理，不调用 AI。虚构演示实验会自动从报告的验证结果中排除。</div>`;
}
/**
 * 打开弹窗并处理已有文档的未保存修改。
 * @param {string} html
 * @param {string} [className]
 */
function openDialog(html, className = '') {
  if (hasUnsavedDocument() && !confirm('文档有尚未保存的修改。确定离开并放弃这些修改吗？')) return;
  modal.className = className;
  modal.innerHTML = html;
  if (!modal.open) modal.showModal();
  const heading = modal.querySelector('h2');
  modal.setAttribute('aria-label', heading?.textContent || '研究记录');
  requestAnimationFrame(() => {
    const target = modal.querySelector('[autofocus]');
    if (target instanceof HTMLElement) target.focus();
  });
}
/**
 * 生成共用表单弹窗，保存交给统一的提交事件处理。
 * @param {string} title
 * @param {string} sub
 * @param {string} body
 * @param {string} formType
 * @param {string} [id]
 */
function formDialog(title, sub, body, formType, id = '') {
  openDialog(
    `<div class="modal-header"><div><h2>${title}</h2><p>${sub}</p></div>${buttonClose('编辑')}</div><form data-form="${formType}" data-id="${esc(id)}"><div class="form-body">${body}<p class="form-error" role="alert"></p></div><div class="modal-footer"><button class="button" type="button" data-action="close">取消</button><button class="button primary" type="submit">${icon('check')}${formType === 'report' ? '生成草稿' : '保存记录'}</button></div></form>`,
    'form-modal',
  );
}
/** @param {string} label @param {string} name @param {string} [value] @param {string} [extra] */
const input = (label, name, value = '', extra = '') =>
  `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${extra}></label>`;
/** @param {string} label @param {string} name @param {string} [value] @param {string} [extra] */
const textarea = (label, name, value = '', extra = '') =>
  `<label class="field"><span>${label}</span><textarea name="${name}" rows="3" ${extra}>${esc(value)}</textarea></label>`;
/**
 * 创建或编辑模型档案，已有编号时回填原内容。
 * @param {string} [id]
 */
function modelForm(id = '') {
  const m = data.models.find((m) => m.id === id);
  formDialog(
    m ? '编辑模型档案' : '记录一个值得研究的模型',
    '记录研究资料；实际接口地址与密钥在档案详情的「配置接入」设置。',
    `<div class="form-grid">${input('模型名称 *', 'name', m?.name, 'required maxlength="120" autofocus')}${input('厂商 / 团队', 'vendor', m?.vendor, 'maxlength="120"')}<label class="field"><span>研究领域</span><select name="domain">${domains.map((d) => option(d, d, m?.domain)).join('')}</select></label><label class="field"><span>研究状态</span><select name="stage">${stages.map((s) => option(s, s, m?.stage)).join('')}</select></label></div><fieldset class="capability-field"><legend>能力方向（至少选择一项）</legend>${['生成编辑', '识别理解'].map((c) => `<label><input type="checkbox" name="capabilities" value="${c}" ${m ? (m.capabilities.includes(c) ? 'checked' : '') : 'checked'}>${c}</label>`).join('')}</fieldset>${textarea('能力摘要 *', 'summary', m?.summary, 'required maxlength="1000" placeholder="例如：文本问答、长文摘要与代码生成；复杂推理效果待验证。"')}${input('核心技术路线', 'route', m?.route, 'placeholder="例如：自回归 Transformer / 扩散模型；以公开资料为准，未知可填待核实" maxlength="300"')}<div class="form-grid">${input('接入 / 部署方式', 'access', m?.access, 'placeholder="例如：云端 API / 本地部署 / 公司内网推理服务" maxlength="300"')}${input('商业许可', 'license', m?.license, 'placeholder="待核实" maxlength="300"')}</div>${input('官方资料 / 论文来源', 'source', m?.source, 'type="url" placeholder="https://…" maxlength="2000"')}${textarea('研究笔记与待验证问题', 'notes', m?.notes, 'maxlength="10000"')}${m?.demo ? '<p class="form-hint">此档案来自示例。保存后将标记为用户记录，事实仍需核实。</p>' : ''}`,
    'model',
    id,
  );
}
/**
 * 展示模型资料、来源和关联实验。
 * @param {string} id
 */
function modelDetail(id) {
  const m = data.models.find((m) => m.id === id);
  if (!m) return;
  const experiments = data.experiments.filter((e) => e.modelId === id);
  openDialog(
    `<div class="detail-art ${m.domain === 'CAD' ? 'art-cad' : m.domain === '图片' ? 'art-image' : m.domain === '视频' ? 'art-video' : 'art-text'}">${artwork(m.domain)}<span class="detail-domain">${m.domain} / ${esc(m.route)}</span>${buttonClose('模型详情')}</div><div class="detail-content"><div class="detail-title"><div><p class="model-vendor">${esc(m.vendor)}</p><h2>${esc(m.name)}</h2></div>${stageBadge(m.stage)}</div><p class="detail-summary">${esc(m.summary)}</p><div class="detail-capabilities">${m.capabilities.map((c) => `<span class="model-chip selected">${c}</span>`).join('')}${m.demo ? '<span class="demo-label">示例资料 · 待核实</span>' : '<span class="user-label">用户记录 · 待复核</span>'}</div><dl class="detail-facts"><div><dt>技术路线</dt><dd>${esc(m.route || '待补充')}</dd></div><div><dt>接入与部署</dt><dd>${esc(m.access || '待核实')}</dd></div><div><dt>商业许可</dt><dd>${esc(m.license || '待核实')}</dd></div><div><dt>记录日期</dt><dd>${esc(m.updated)}</dd></div></dl><section class="detail-notes"><h3>研究笔记</h3><p>${esc(m.notes || '还没有研究笔记，记录你的第一个问题。')}</p></section><section class="detail-notes"><h3>相关实验 <span class="muted">${experiments.length}</span></h3>${experiments.map((e) => `<button class="detail-experiment" data-action="experiment-detail" data-id="${esc(e.id)}">${icon('experiments')}<span>${esc(e.title)}</span>${e.demo ? '<span class="demo-label">演示</span>' : ''}${icon('chevron')}</button>`).join('') || '<p class="muted">尚无实验记录，暂不能判断实际效果。</p>'}</section>${sourceLink(m.source)}</div><div class="modal-footer"><button class="button" data-action="model-connection" data-id="${esc(id)}">${icon('models')}配置接入</button><button class="button" data-action="new-experiment" data-id="${esc(id)}">${icon('experiments')}记录实验</button><button class="button primary" data-action="edit-model" data-id="${esc(id)}">${icon('edit')}编辑档案</button></div>`,
    'detail-modal',
  );
}
/** 在模型档案内配置可调用的接口；密钥输入始终留空，不读回服务器密文。 @param {string} id */
async function modelConnectionForm(id) {
  const model = data.models.find((m) => m.id === id);
  if (!model) return;
  const marker = uid('connection');
  openDialog(
    `<div class="modal-header"><div><h2>配置模型接入</h2><p>${esc(model.name)}</p></div>${buttonClose('接入配置')}</div><div class="form-body" id="${marker}">正在读取接入配置…</div>`,
    'form-modal',
  );
  try {
    const connections = await runtimeApi.getModelConnections();
    if (!modal.open || !modal.querySelector(`#${marker}`)) return;
    const c = connections.find((item) => item.model_id === id);
    formDialog(
      '配置模型接入',
      esc(model.name),
      `<div class="connection-intro"><span class="eyebrow">MODEL CONNECTION</span><p>将研究档案连接到可运行的模型，在运行工作室开始对话。</p></div><div class="form-grid"><label class="field"><span>适配协议</span><select name="provider"><option value="openai" ${c?.provider !== 'anthropic' ? 'selected' : ''}>OpenAI 兼容</option><option value="anthropic" ${c?.provider === 'anthropic' ? 'selected' : ''}>Anthropic</option></select></label>${input('API 模型名 *', 'api_model', c?.api_model, 'required maxlength="200" placeholder="接口要求的模型标识"')}</div>${input('Base URL *', 'base_url', c?.base_url || 'https://api.openai.com/v1', 'required type="url" maxlength="2000"')}<p class="form-hint">OpenAI 兼容接口通常以 /v1 结尾；Anthropic 官方为 https://api.anthropic.com。</p>${input(c?.api_key_configured ? 'API Key（已保存，留空保留）' : 'API Key（无密钥的本地接口可留空）', 'api_key', '', 'type="password" autocomplete="new-password" maxlength="8192"')}${c?.api_key_configured ? '<label class="acknowledge"><input type="checkbox" name="clear_api_key">清除已保存的 API Key</label>' : ''}${textarea('系统提示词', 'system_prompt', c?.system_prompt ?? '你是严谨的多模态模型研究助手。区分事实、推断与待验证问题。', 'maxlength="20000" rows="4"')}<div class="form-grid">${input('温度（可选）', 'temperature', c?.temperature == null ? '' : String(c.temperature), 'type="number" min="0" max="2" step="any" placeholder="留空使用模型默认值"')}${input('最大输出 Token *', 'max_tokens', String(c?.max_tokens ?? 2048), 'required type="number" min="1" max="131072" step="1"')}${input('模型请求超时（秒）*', 'timeout_seconds', String(c?.timeout_seconds ?? 120), 'required type="number" min="5" max="600" step="1"')}</div><label class="acknowledge"><input type="checkbox" name="enabled" ${c?.enabled !== false ? 'checked' : ''}>在运行工作室启用此模型</label><input type="hidden" name="expected_revision" value="${c?.revision ?? 0}"><p class="form-hint">密钥加密保存于服务端，不加入研究备份。保存配置不会发起模型请求。</p>`,
      'model-connection',
      id,
    );
  } catch (error) {
    if (modal.querySelector(`#${marker}`)) {
      const node = modal.querySelector(`#${marker}`);
      if (node)
        node.textContent =
          error instanceof Error ? error.message : '接入配置加载失败，请关闭后重试。';
    }
  }
}
/**
 * 创建或编辑实验，演示记录转为真实记录前需要明确确认。
 * @param {string} [modelId]
 * @param {string} [id]
 * @param {import('./types').RuntimeRun | null} [run]
 */
function experimentForm(modelId = '', id = '', run = null) {
  if (!data.models.length) {
    toast('请先创建模型档案。');
    modelForm();
    return;
  }
  const e = data.experiments.find((e) => e.id === id);
  formDialog(
    e ? '编辑实验记录' : '记录一次真实的验证',
    '此处记录已执行的实验，不会调用模型。请保留失败案例。',
    `${input('实验标题 *', 'title', e?.title, 'required autofocus maxlength="200"')}<div class="form-grid"><label class="field"><span>被测模型</span><select name="modelId">${data.models.map((m) => option(m.id, m.name, e?.modelId || modelId)).join('')}</select></label><label class="field"><span>任务类型</span><select name="task">${['识别理解', '生成编辑'].map((t) => option(t, t, e?.task)).join('')}</select></label></div>${input('样本集 / 数据说明 *', 'dataset', e?.dataset, 'required maxlength="1000" placeholder="例如：10 条客服问题，覆盖退款和物流；或本轮聊天的测试问题"')}<div class="form-grid">${input('样本数量 *', 'sampleSize', String(e?.sampleSize ?? ''), 'type="number" min="1" max="10000000" step="1" required')}${input('成功数量 *', 'successCount', String(e?.successCount ?? ''), 'type="number" min="0" max="10000000" step="1" required')}${input('单次耗时（秒，可选）', 'latency', e?.latency == null ? '' : String(e.latency), 'type="number" min="0" step="any"')}${input('单次成本（元，可选）', 'cost', e?.cost == null ? '' : String(e.cost), 'type="number" min="0" step="any"')}</div><p class="form-hint">样本数量是本次实际测试条数，成功数量是按你定义的标准判定达标的条数。当前由你评价填写，不自动判分；接口调用成功不代表回答质量达标。</p>${textarea('成功标准与实验结论 *', 'conclusion', e?.conclusion, 'required maxlength="10000"')}${textarea('限制与失败案例 *', 'limitations', e?.limitations, 'required maxlength="10000"')}${e?.demo ? '<label class="acknowledge"><input type="checkbox" name="confirm-real" required>我已将演示内容替换为真实实验记录。</label>' : ''}`,
    'experiment',
    id,
  );
  if (run) {
    const form = modal.querySelector('form');
    if (!(form instanceof HTMLFormElement)) return;
    form.setAttribute('data-run-id', run.id);
    const defaults = {
      title: `对话验证 · ${run.model_snapshot?.name || '模型'}`,
      dataset: '运行工作室 · 单轮对话（参见原始输入与输出）',
      sampleSize: '1',
      latency:
        typeof run.output?.latency_seconds === 'number' ? String(run.output.latency_seconds) : '',
    };
    for (const [name, value] of Object.entries(defaults)) {
      const control = form.elements.namedItem(name);
      if (control instanceof HTMLInputElement) control.value = value;
    }
    const modelSelect = form.elements.namedItem('modelId');
    if (modelSelect instanceof HTMLSelectElement) {
      modelSelect.disabled = true;
      form.insertAdjacentHTML(
        'beforeend',
        `<input type="hidden" name="modelId" value="${esc(modelId)}">`,
      );
    }
    form
      .querySelector('.form-body')
      ?.insertAdjacentHTML(
        'afterbegin',
        `<details class="experiment-source" open><summary>本轮原始输入与输出 · ${esc(run.model_snapshot?.api_model || '')}</summary><h4>输入</h4><pre>${esc(run.input)}</pre><h4>输出</h4><pre>${esc(run.output?.message || '')}</pre><p>请按实际标准填写成功数量、结论和限制；成本可留空。</p></details>`,
      );
    const subtitle = modal.querySelector('.modal-header p');
    if (subtitle) subtitle.textContent = '确认本轮模型结果，补充评价后加入实验对比。';
  }
}
/**
 * 展示实验样本、结果和限制，演示实验会单独标记。
 * @param {string} id
 */
function experimentDetail(id) {
  const e = data.experiments.find((e) => e.id === id);
  if (!e) return;
  openDialog(
    `<div class="modal-header"><div><p class="eyebrow">实验记录 ${e.demo ? ' / 虚构演示' : ''}</p><h2>${esc(e.title)}</h2></div>${buttonClose('实验')}</div><div class="detail-content"><p class="detail-summary">${esc(data.models.find((m) => m.id === e.modelId)?.name ?? '')} · ${esc(e.task)} · ${esc(e.date)}</p>${e.demo ? '<p class="warning-note">此实验为虚构演示，所有数字不能作为模型评估或选型依据。</p>' : ''}<dl class="detail-facts"><div><dt>样本集</dt><dd>${esc(e.dataset)}</dd></div><div><dt>成功 / 总数</dt><dd>${e.successCount} / ${e.sampleSize}（${((e.successCount / e.sampleSize) * 100).toFixed(1)}%）</dd></div><div><dt>单次耗时</dt><dd>${e.latency === null ? '未记录' : e.latency + ' 秒'}</dd></div><div><dt>单次成本</dt><dd>${e.cost === null ? '未记录' : e.cost + ' 元'}</dd></div></dl><section class="detail-notes"><h3>结论与成功标准</h3><p>${esc(e.conclusion)}</p></section><section class="detail-notes"><h3>限制与失败案例</h3><p>${esc(e.limitations)}</p></section></div><div class="modal-footer"><button class="button primary" data-action="edit-experiment" data-id="${esc(id)}">${icon('edit')}编辑记录</button></div>`,
    'detail-modal',
  );
  const source = document.createElement('div');
  source.className = 'experiment-source-slot';
  modal.querySelector('.detail-content')?.append(source);
  void runtimeApi
    .getExperimentSource(id)
    .then((run) => {
      if (!source.isConnected || !modal.open || !run) return;
      source.innerHTML = `<details class="experiment-source"><summary>关联模型运行 · ${esc(run.model_snapshot?.name || '')}</summary><p>${esc(run.started_at)} / ${esc(run.model_snapshot?.provider || '')} / ${esc(run.model_snapshot?.api_model || '')}</p><h4>系统提示词</h4><pre>${esc(run.model_snapshot?.system_prompt || '未设置')}</pre><h4>输入</h4><pre>${esc(run.input)}</pre><h4>输出</h4><pre>${esc(run.output?.message || '')}</pre></details>`;
    })
    .catch((error) => {
      if (source.isConnected)
        source.textContent =
          error instanceof Error ? `运行来源读取失败：${error.message}` : '运行来源读取失败。';
    });
}
/**
 * 创建或编辑研究手记。
 * @param {string} [id]
 */
function noteForm(id = '') {
  const n = data.notes.find((n) => n.id === id);
  formDialog(
    n ? '编辑研究手记' : '留下一条新的发现',
    '记录技术方向、原始资料和你想进一步验证的问题。',
    `${input('研究标题 *', 'title', n?.title, 'required autofocus maxlength="200"')}<div class="form-grid"><label class="field"><span>研究领域</span><select name="domain">${domains.map((d) => option(d, d, n?.domain)).join('')}</select></label><label class="field"><span>研究状态</span><select name="stage">${stages.map((s) => option(s, s, n?.stage)).join('')}</select></label></div>${textarea('观察、问题与下一步 *', 'body', n?.body, 'required maxlength="20000" rows="7"')}${input('原始来源', 'source', n?.source, 'type="url" placeholder="https://…" maxlength="2000"')}`,
    'note',
    id,
  );
}
/**
 * 展示手记正文、来源和当前进展。
 * @param {string} id
 */
function noteDetail(id) {
  const n = data.notes.find((n) => n.id === id);
  if (!n) return;
  openDialog(
    `<div class="modal-header"><div><p class="eyebrow">${n.domain} / 研究手记${n.demo ? ' / 示例' : ''}</p><h2>${esc(n.title)}</h2></div>${buttonClose('手记')}</div><div class="detail-content">${stageBadge(n.stage)}<div class="note-detail-body">${esc(n.body)}</div>${sourceLink(n.source)}<p class="muted">记录日期：${esc(n.date)}</p></div><div class="modal-footer"><button class="button primary" data-action="edit-note" data-id="${esc(id)}">${icon('edit')}编辑手记</button></div>`,
    'detail-modal',
  );
}
/**
 * 选择报告模板、模型和日期范围，后续用已有记录整理草稿。
 * @param {string} [kind]
 */
function reportForm(kind = '研究周报') {
  if (!data.models.length) {
    toast('先记录模型，再创建交付物。');
    modelForm();
    return;
  }
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - 6);
  const start = kind === '研究周报' ? weekStart.toLocaleDateString('sv-SE') : '';
  const end = kind === '研究周报' ? today() : '';
  formDialog(
    '创建一份交付物',
    '选取研究范围，系统按模板整理为可编辑草稿。',
    `<label class="field"><span>交付物类型</span><select name="kind">${kinds.map((k) => option(k, k, kind)).join('')}</select></label>${input('文档标题 *', 'title', `多模态 AI ${kind} · ${today()}`, 'required autofocus maxlength="200"')}<div class="form-grid">${input('记录开始日期（可选）', 'start', start, 'type="date"')}${input('记录结束日期（可选）', 'end', end, 'type="date"')}</div><fieldset class="report-model-picker"><legend>纳入哪些模型？（至少选择一项）</legend>${data.models.map((m) => `<label><input type="checkbox" name="modelIds" value="${esc(m.id)}" ${!comparedIds.length || comparedIds.includes(m.id) ? 'checked' : ''}><span><strong>${esc(m.name)}</strong><small>${m.domain} / ${esc(m.stage)}</small></span>${m.demo ? '<span class="demo-label">示例</span>' : ''}</label>`).join('')}</fieldset><div class="form-hint">日期筛选实验与手记，模型档案使用当前快照。虚构演示成绩会被排除；生成后请补充业务背景，并核实来源。</div>`,
    'report',
  );
}
/**
 * 打开 Markdown 编辑与预览，保存后写入线上数据库。
 * @param {string} id
 */
function artifactDetail(id) {
  const a = data.artifacts.find((a) => a.id === id);
  if (!a) return;
  openDialog(
    `<div class="modal-header"><div><p class="eyebrow">${esc(a.kind)} / 待复核草稿</p><h2>${esc(a.title)}</h2></div>${buttonClose('文档')}</div><div class="document-toolbar"><span>修改后请保存；导出会使用编辑区当前内容。</span><div><button class="button subtle" data-action="export-md" data-id="${esc(id)}">${icon('download')}Markdown</button><button class="button subtle" data-action="export-html" data-id="${esc(id)}">${icon('download')}HTML</button><button class="button subtle" data-action="print-report" data-id="${esc(id)}">${icon('print')}打印 / PDF</button></div></div><div class="document-workspace"><label class="document-editor"><span>Markdown 编辑</span><textarea id="document-content" data-id="${esc(id)}" spellcheck="false">${esc(a.content)}</textarea></label><article class="document-preview"><span class="preview-caption">文档预览</span><div id="document-preview-content" class="report-content">${renderMarkdown(a.content)}</div></article></div><div class="modal-footer"><span class="muted" id="save-indicator">已保存到云端数据库</span><button class="button primary" data-action="save-artifact" data-id="${esc(id)}">${icon('check')}保存修改</button></div>`,
    'document-modal',
  );
}

/** 打开全局搜索，范围包含模型、实验、手记和交付物。 */
function searchDialog() {
  openDialog(
    `<div class="search-modal-head">${icon('search')}<input id="global-query" placeholder="搜索模型、实验、手记和交付物" aria-label="全局搜索" autofocus>${buttonClose('搜索')}</div><div id="global-results" class="global-results"><p class="muted">输入关键词，找到你记录过的线索。</p></div><div class="search-hint">支持模型名称、摘要、技术路线与记录内容</div>`,
    'search-modal',
  );
}
/**
 * 按当前输入筛选各类记录，只展示转义后的文本。
 * @param {string} term
 */
function updateGlobalSearch(term) {
  const lower = term.trim().toLowerCase();
  const target = document.querySelector('#global-results');
  if (!target) return;
  if (!lower) {
    target.innerHTML = '<p class="muted">输入关键词，找到你记录过的线索。</p>';
    return;
  }
  const results = [
    ...data.models
      .filter((m) => [m.name, m.summary, m.route, m.notes].join(' ').toLowerCase().includes(lower))
      .map((m) => ({ title: m.name, type: '模型档案', action: 'detail', id: m.id })),
    ...data.experiments
      .filter((e) => [e.title, e.conclusion, e.dataset].join(' ').toLowerCase().includes(lower))
      .map((e) => ({ title: e.title, type: '实验记录', action: 'experiment-detail', id: e.id })),
    ...data.notes
      .filter((n) => [n.title, n.body].join(' ').toLowerCase().includes(lower))
      .map((n) => ({ title: n.title, type: '研究手记', action: 'note-detail', id: n.id })),
    ...data.artifacts
      .filter((a) => [a.title, a.content].join(' ').toLowerCase().includes(lower))
      .map((a) => ({ title: a.title, type: '交付物', action: 'artifact', id: a.id })),
  ];
  target.innerHTML = results.length
    ? results
        .slice(0, 30)
        .map(
          (r) =>
            `<button class="search-result" data-action="${r.action}" data-id="${esc(r.id)}"><span><strong>${esc(r.title)}</strong><small>${r.type}</small></span>${icon('chevron')}</button>`,
        )
        .join('')
    : emptyState('没有找到相关记录', '试试更短的关键词。');
}
/**
 * 导出时优先取编辑器里的当前内容，不只使用上次保存的版本。
 * @param {string} id
 */
function currentDocument(id) {
  const editor = document.querySelector('#document-content');
  return editor instanceof HTMLTextAreaElement && editor.dataset.id === id
    ? editor.value
    : (data.artifacts.find((a) => a.id === id)?.content ?? '');
}
/** 比较编辑内容和已保存正文，避免关闭时丢失修改。 */
function hasUnsavedDocument() {
  if (!modal.open) return false;
  const editor = modal.querySelector('#document-content');
  if (!(editor instanceof HTMLTextAreaElement)) return false;
  return editor.value !== data.artifacts.find((a) => a.id === editor.dataset.id)?.content;
}
/** 关闭弹窗前检查文档是否有未保存修改。 */
function closeDialog() {
  if (saving) {
    toast('正在保存，请稍候。');
    return;
  }
  if (!hasUnsavedDocument() || confirm('文档有尚未保存的修改。确定关闭并放弃这些修改吗？'))
    modal.close();
}
/**
 * 导出当前正文为 Markdown 或可独立打开的 HTML。
 * @param {string} id
 * @param {string} format
 */
function exportArtifact(id, format) {
  const a = data.artifacts.find((a) => a.id === id);
  if (!a) return;
  const content = currentDocument(id);
  if (format === 'md') download(a.title + '.md', content, 'text/markdown;charset=utf-8');
  else download(a.title + '.html', reportHtml(a.title, content), 'text/html;charset=utf-8');
  toast('已导出文档。');
}
/**
 * 用临时 iframe 打印报告，打印结束后移除 iframe。
 * @param {string} id
 */
function printArtifact(id) {
  const a = data.artifacts.find((a) => a.id === id);
  if (!a) return;
  const frame = document.createElement('iframe');
  frame.className = 'print-frame';
  frame.title = '交付文档打印预览';
  frame.srcdoc = reportHtml(a.title, currentDocument(id));
  frame.addEventListener(
    'load',
    () => {
      const win = frame.contentWindow;
      if (!win) {
        frame.remove();
        return;
      }
      win.addEventListener('afterprint', () => frame.remove(), { once: true });
      win.focus();
      win.print();
    },
    { once: true },
  );
  document.body.append(frame);
}

document.addEventListener('click', async (event) => {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest('[data-action]');
  if (!(target instanceof HTMLElement)) return;
  const { action, id = '' } = target.dataset;
  if (action === 'retry-workspace') {
    await loadWorkspace();
    return;
  }
  if (workspaceLoading || saving) {
    toast(workspaceLoading ? '正在加载线上记录…' : '正在保存，请稍候。');
    return;
  }
  if (action === 'close') {
    closeDialog();
    return;
  }
  if (action === 'menu') {
    mobileNav = !mobileNav;
    shell();
    return;
  }
  if (action === 'search') {
    searchDialog();
    return;
  }
  if (action === 'new-model') {
    modelForm();
    return;
  }
  if (action === 'edit-model') {
    modelForm(id);
    return;
  }
  if (action === 'detail') {
    modelDetail(id);
    return;
  }
  if (action === 'model-connection') {
    await modelConnectionForm(id);
    return;
  }
  if (action === 'new-experiment') {
    experimentForm(id);
    return;
  }
  if (action === 'edit-experiment') {
    experimentForm('', id);
    return;
  }
  if (action === 'experiment-detail') {
    experimentDetail(id);
    return;
  }
  if (action === 'new-note') {
    noteForm();
    return;
  }
  if (action === 'edit-note') {
    noteForm(id);
    return;
  }
  if (action === 'note-detail') {
    noteDetail(id);
    return;
  }
  if (action === 'new-report') {
    reportForm(target.dataset.kind);
    return;
  }
  if (action === 'artifact') {
    artifactDetail(id);
    return;
  }
  if (action === 'favorite') {
    if (
      await commit((next) => {
        const m = next.models.find((m) => m.id === id);
        if (m) m.favorite = !m.favorite;
      })
    )
      shell();
    return;
  }
  if (action === 'filter-domain') {
    domainFilter = id;
    shell();
    return;
  }
  if (action === 'domain-nav') {
    domainFilter = id;
    query = '';
    capabilityFilter = '全部能力';
    stageFilter = '全部状态';
    favoritesOnly = false;
    if (page === 'models') shell();
    else location.hash = 'models';
    return;
  }
  if (action === 'favorites') {
    favoritesOnly = !favoritesOnly;
    shell();
    return;
  }
  if (action === 'clear-filters') {
    domainFilter = '全部';
    capabilityFilter = '全部能力';
    stageFilter = '全部状态';
    query = '';
    favoritesOnly = false;
    shell();
    return;
  }
  if (action === 'compare-model') {
    comparedIds = comparedIds.includes(id)
      ? comparedIds.filter((v) => v !== id)
      : [...comparedIds, id];
    shell();
    return;
  }
  if (action === 'export-md' || action === 'export-html') {
    exportArtifact(id, action === 'export-md' ? 'md' : 'html');
    return;
  }
  if (action === 'print-report') {
    printArtifact(id);
    return;
  }
  if (action === 'save-artifact') {
    const text = currentDocument(id);
    if (text.length > 200000) {
      toast('文档超过 20 万字符，请拆分后保存。');
      return;
    }
    if (
      await commit((next) => {
        const a = next.artifacts.find((a) => a.id === id);
        if (a) a.content = text;
      })
    ) {
      const indicator = document.querySelector('#save-indicator');
      if (indicator) indicator.textContent = '已保存到云端数据库';
      toast('文档已保存。');
    }
    return;
  }
  if (action === 'backup') {
    download(`Prism-研究备份-${today()}.json`, JSON.stringify(data, null, 2), 'application/json');
    toast('已导出完整备份。');
    return;
  }
  if (action === 'raw-backup') {
    try {
      download(`Prism-原始存储-${today()}.txt`, getLegacyBackup());
    } catch {
      toast('浏览器阻止读取存储，请检查站点权限。');
    }
    return;
  }
  if (action === 'import') {
    fileInput.value = '';
    fileInput.click();
    return;
  }
  if (action === 'about')
    openDialog(
      `<div class="modal-header"><div><h2>你的研究，有一个安放的地方。</h2><p>Prism · 多模态研究工作台</p></div>${buttonClose('关于')}</div><div class="detail-content"><p>记录图片、CAD、视频和语言文本模型，追踪前沿技术，保存实验依据，整理可交付的研究成果。</p><h3>当前版本</h3><p>研究记录保存在服务器 PostgreSQL 数据库。首次加载会将旧浏览器记录迁入数据库，成功后清理旧存储。备份与恢复通过 JSON 文件完成。</p><p>文档生成使用模板，尚未接入模型推理与自动联网搜集。示例档案不代表最新模型列表，演示实验不代表实际成绩。</p><button class="button" data-action="backup">${icon('download')}导出研究备份</button></div>`,
      'detail-modal',
    );
});
document.addEventListener('input', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.id === 'model-query') {
    query = target.value;
    const results = document.querySelector('#model-results');
    if (results) results.innerHTML = modelResults();
    const counter = document.querySelector('#model-count');
    if (counter) counter.textContent = `${filteredModels().length} 个模型`;
  }
  if (target instanceof HTMLInputElement && target.id === 'global-query')
    updateGlobalSearch(target.value);
  if (target instanceof HTMLTextAreaElement && target.id === 'document-content') {
    const preview = document.querySelector('#document-preview-content');
    if (preview) preview.innerHTML = renderMarkdown(target.value);
    const indicator = document.querySelector('#save-indicator');
    if (indicator) indicator.textContent = '有尚未保存的修改';
  }
});
document.addEventListener('change', async (event) => {
  if (
    event.target instanceof HTMLSelectElement &&
    event.target.name === 'provider' &&
    event.target.form?.getAttribute('data-form') === 'model-connection'
  ) {
    const base = event.target.form.elements.namedItem('base_url');
    const temperature = event.target.form.elements.namedItem('temperature');
    const anthropic = event.target.value === 'anthropic';
    if (
      base instanceof HTMLInputElement &&
      ['', 'https://api.openai.com/v1', 'https://api.anthropic.com'].includes(base.value)
    )
      base.value = anthropic ? 'https://api.anthropic.com' : 'https://api.openai.com/v1';
    if (temperature instanceof HTMLInputElement) temperature.max = anthropic ? '1' : '2';
    return;
  }
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.id === 'capability-filter') {
    capabilityFilter = target.value;
    shell();
  }
  if (target.id === 'stage-filter') {
    stageFilter = target.value;
    shell();
  }
  if (target.dataset.noteStage) {
    const stage = stages.find((s) => s === target.value);
    if (!stage) return;
    if (
      await commit((next) => {
        const n = next.notes.find((n) => n.id === target.dataset.noteStage);
        if (n) {
          n.stage = stage;
          n.date = today();
        }
      })
    ) {
      shell();
      toast('研究状态已更新。');
    }
  }
});
document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  // 表单里有名为 dataset 的控件，直接用 form.dataset 会读错对象。
  const formType = form.getAttribute('data-form');
  if (!formType) return;
  event.preventDefault();
  const fields = new FormData(form);
  /** @param {string} key */
  const field = (key) => String(fields.get(key) ?? '').trim();
  const existingId = form.getAttribute('data-id') ?? '';
  try {
    if (formType === 'model-connection') {
      if (saving) return;
      const provider = field('provider');
      if (provider !== 'openai' && provider !== 'anthropic') throw new Error('请选择适配协议。');
      saving = true;
      const submit = form.querySelector('button[type="submit"]');
      if (submit instanceof HTMLButtonElement) submit.disabled = true;
      try {
        await runtimeApi.saveModelConnection(existingId, {
          provider,
          api_model: field('api_model'),
          base_url: field('base_url'),
          api_key: field('api_key'),
          clear_api_key: fields.get('clear_api_key') === 'on',
          enabled: fields.get('enabled') === 'on',
          system_prompt: field('system_prompt'),
          temperature: field('temperature') ? Number(field('temperature')) : null,
          max_tokens: Number(field('max_tokens')),
          timeout_seconds: Number(field('timeout_seconds')),
          expected_revision: Number(field('expected_revision')),
        });
        const secret = form.elements.namedItem('api_key');
        if (secret instanceof HTMLInputElement) secret.value = '';
        window.dispatchEvent(new Event('prism:model-connections-changed'));
        modal.close();
        toast('接入配置已保存，可在运行工作室选择此模型。');
      } finally {
        saving = false;
        if (submit instanceof HTMLButtonElement) submit.disabled = false;
      }
      return;
    }
    if (formType === 'model') {
      const capabilities = fields
        .getAll('capabilities')
        .map(String)
        .filter((c) => c === '生成编辑' || c === '识别理解');
      if (!capabilities.length) throw new Error('请至少选择一个能力方向。');
      if (!field('name') || !field('summary')) throw new Error('请填写模型名称和能力摘要。');
      if (field('source') && !safeUrl(field('source')))
        throw new Error('来源仅支持 http 或 https 链接。');
      const domain = domains.find((d) => d === field('domain'));
      const stage = stages.find((s) => s === field('stage'));
      if (!domain || !stage) return;
      const old = data.models.find((m) => m.id === existingId);
      /** @type {import('./types').ModelRecord} */
      const m = {
        id: old?.id ?? uid('model'),
        name: field('name'),
        vendor: field('vendor'),
        domain,
        stage,
        capabilities,
        summary: field('summary'),
        route: field('route'),
        access: field('access'),
        license: field('license') || '待核实',
        source: field('source'),
        notes: field('notes'),
        updated: today(),
        demo: false,
        favorite: old?.favorite ?? false,
      };
      if (
        !(await commit((next) => {
          const index = next.models.findIndex((item) => item.id === m.id);
          if (index >= 0) next.models[index] = m;
          else next.models.unshift(m);
        }))
      )
        return;
      modal.close();
      shell();
      toast('模型档案已保存。');
    }
    if (formType === 'experiment') {
      const sampleSize = Number(field('sampleSize'));
      const successCount = Number(field('successCount'));
      const latency = field('latency') ? Number(field('latency')) : null;
      const cost = field('cost') ? Number(field('cost')) : null;
      if (
        !Number.isInteger(sampleSize) ||
        sampleSize < 1 ||
        !Number.isInteger(successCount) ||
        successCount < 0 ||
        successCount > sampleSize
      )
        throw new Error('成功数量必须为 0 到样本数量之间的整数。');
      if ([latency, cost].some((v) => v !== null && (!Number.isFinite(v) || v < 0)))
        throw new Error('耗时和成本需要填写非负数字。');
      if (!field('title') || !field('dataset') || !field('conclusion') || !field('limitations'))
        throw new Error('请完整填写标题、样本说明、结论和限制。');
      if (
        data.experiments.find((e) => e.id === existingId)?.demo &&
        fields.get('confirm-real') !== 'on'
      )
        throw new Error('请确认已将演示内容替换为真实实验。');
      /** @type {import('./types').Experiment} */
      const e = {
        id: existingId || uid('exp'),
        title: field('title'),
        modelId: field('modelId'),
        task: field('task'),
        dataset: field('dataset'),
        sampleSize,
        successCount,
        latency,
        cost,
        conclusion: field('conclusion'),
        limitations: field('limitations'),
        demo: false,
        date: today(),
      };
      const sourceRunId = form.getAttribute('data-run-id');
      if (sourceRunId) {
        if (saving) return;
        saving = true;
        const submit = form.querySelector('button[type="submit"]');
        if (submit instanceof HTMLButtonElement) submit.disabled = true;
        try {
          await runtimeApi.confirmExperiment(sourceRunId, e);
          const snapshot = await getWorkspace();
          data = snapshot.data;
          revision = snapshot.revision;
          location.hash = 'experiments';
        } finally {
          saving = false;
          if (submit instanceof HTMLButtonElement) submit.disabled = false;
        }
      } else if (
        !(await commit((next) => {
          const index = next.experiments.findIndex((item) => item.id === e.id);
          if (index >= 0) next.experiments[index] = e;
          else next.experiments.unshift(e);
        }))
      )
        return;
      modal.close();
      shell();
      toast('实验记录已保存。');
    }
    if (formType === 'note') {
      const domain = domains.find((d) => d === field('domain'));
      const stage = stages.find((s) => s === field('stage'));
      if (!domain || !stage) return;
      if (!field('title') || !field('body')) throw new Error('请填写标题和研究内容。');
      if (field('source') && !safeUrl(field('source')))
        throw new Error('来源仅支持 http 或 https 链接。');
      /** @type {import('./types').ResearchNote} */
      const n = {
        id: existingId || uid('note'),
        title: field('title'),
        domain,
        stage,
        body: field('body'),
        source: field('source'),
        date: today(),
        demo: false,
      };
      if (
        !(await commit((next) => {
          const index = next.notes.findIndex((item) => item.id === n.id);
          if (index >= 0) next.notes[index] = n;
          else next.notes.unshift(n);
        }))
      )
        return;
      modal.close();
      shell();
      toast('研究手记已保存。');
    }
    if (formType === 'report') {
      const ids = fields.getAll('modelIds').map(String);
      const kind = kinds.find((k) => k === field('kind'));
      if (!kind) return;
      const title = field('title');
      if (!title) throw new Error('请填写文档标题。');
      const content = generateReport(kind, title, ids, data, {
        start: field('start'),
        end: field('end'),
      });
      /** @type {import('./types').Artifact} */
      const a = { id: uid('report'), title, kind, modelIds: ids, content, date: today() };
      if (!(await commit((next) => next.artifacts.unshift(a)))) return;
      location.hash = 'deliverables';
      shell();
      artifactDetail(a.id);
      toast('草稿已生成，请复核并补充。');
    }
  } catch (error) {
    const node = form.querySelector('.form-error');
    if (node) node.textContent = error instanceof Error ? error.message : '保存失败，请检查内容。';
  }
});
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    toast('备份文件超过 10MB，请检查文件。');
    return;
  }
  toast('正在读取研究备份…');
  try {
    const imported = JSON.parse(await file.text());
    if (!isWorkspace(imported)) throw new Error('备份格式无效，现有记录未改变。');
    openDialog(
      `<div class="modal-header"><div><h2>恢复研究备份</h2><p>请核对备份内容</p></div>${buttonClose('恢复')}</div><div class="detail-content"><p>备份包含 ${imported.models.length} 个模型、${imported.experiments.length} 条实验、${imported.notes.length} 条手记及 ${imported.artifacts.length} 份交付物。</p><p class="warning-note">恢复将替换线上研究空间中的全部记录。建议先导出当前备份。</p><div class="restore-actions"><button class="button" data-action="${storageError ? 'raw-backup' : 'backup'}">导出当前记录</button><button class="button primary" id="confirm-restore">确认恢复</button></div></div>`,
      'detail-modal',
    );
    const restoreButton = document.querySelector('#confirm-restore');
    if (!(restoreButton instanceof HTMLButtonElement)) return;
    restoreButton.addEventListener('click', async () => {
      if (saving || workspaceLoading) return;
      saving = true;
      restoreButton.disabled = true;
      restoreButton.textContent = '正在恢复到云端…';
      try {
        const snapshot = await persistWorkspace(imported, revision);
        data = snapshot.data;
        revision = snapshot.revision;
        storageError = '';
        comparedIds = [];
        modal.close();
        shell();
        toast('研究备份已恢复。');
      } catch (error) {
        toast(error instanceof Error ? error.message : '恢复失败，线上记录未改变。');
      } finally {
        saving = false;
        restoreButton.disabled = false;
        restoreButton.textContent = '确认恢复';
      }
    });
  } catch (error) {
    toast(error instanceof Error ? error.message : '无法读取备份文件。');
  }
});
modal.addEventListener('click', (event) => {
  if (event.target === modal) {
    const rect = modal.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      closeDialog();
  }
});
modal.addEventListener('cancel', (event) => {
  if (saving) {
    event.preventDefault();
    return;
  }
  if (hasUnsavedDocument()) {
    event.preventDefault();
    closeDialog();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (hasUnsavedDocument() || saving) event.preventDefault();
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchDialog();
  }
});
/** 读取地址中的页面名，切换导航后重新绘制页面。 */
function route() {
  page = pages.find((p) => p === location.hash.slice(1)) ?? 'overview';
  mobileNav = false;
  shell();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', route);
window.addEventListener('prism:record-experiment', async (event) => {
  if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
  if (saving || workspaceLoading || storageError) {
    toast('请等待研究空间加载完成后重试。');
    return;
  }
  if (modal.open) {
    toast('请先关闭当前编辑窗口。');
    return;
  }
  try {
    const run = await runtimeApi.getRun(event.detail);
    if (run.status !== 'success' || run.output?.execution_mode !== 'model' || !run.model_id)
      throw new Error('仅成功的模型结果可以录入实验。');
    if (!data.models.some((m) => m.id === run.model_id))
      throw new Error('原模型档案已删除，请先恢复档案。');
    if (!modal.open) experimentForm(run.model_id, '', run);
  } catch (error) {
    toast(error instanceof Error ? error.message : '无法读取模型结果。');
  }
});
route();
mountRuntimeConsole();
void loadWorkspace();
