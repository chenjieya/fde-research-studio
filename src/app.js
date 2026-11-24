import { readWorkspace, persistWorkspace, escapeHtml as esc, download, safeUrl, isWorkspace, uid, today, domains, stages, kinds } from './lib/workspace.js';
import { generateReport, renderMarkdown, reportHtml } from './lib/reports.js';
import { icon, artwork, modelCard } from './components/visuals.js';

/** @template {Element} T @param {string} selector @param {new (...args: never[]) => T} type @returns {T} */
function element(selector, type) {
  const node = document.querySelector(selector);
  if (!(node instanceof type)) throw new Error(`未找到页面元素：${selector}`);
  return node;
}
const app = element('#app', HTMLDivElement);
const modal = element('#modal', HTMLDialogElement);
const toastNode = element('#toast', HTMLDivElement);
const fileInput = element('#import-file', HTMLInputElement);
const loaded = readWorkspace();
let data = loaded.data;
let storageError = loaded.error;
/** @type {import('./types').Page[]} */
const pages = ['overview', 'models', 'experiments', 'frontier', 'deliverables'];
const labels = { overview: '研究总览', models: '模型档案', experiments: '实验对比', frontier: '前沿追踪', deliverables: '交付工作室' };
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
/** @param {string} message */
function toast(message) {
  clearTimeout(toastTimer); toastNode.textContent = message; toastNode.classList.add('show');
  toastTimer = setTimeout(() => toastNode.classList.remove('show'), 3500);
}
/** @param {(next: import('./types').Workspace) => void} update */
function commit(update) {
  if (storageError) { toast('本地数据读取异常，请先备份或恢复记录，避免覆盖原数据。'); return false; }
  const next = structuredClone(data); update(next);
  try { persistWorkspace(next); data = next; return true; }
  catch { toast('保存失败，浏览器存储不可用或空间不足。请导出备份后重试。'); return false; }
}
/** @param {string} value */
const buttonClose = value => `<button type="button" class="icon-button" data-action="close" aria-label="关闭${value}">${icon('close')}</button>`;
/** @param {string} title @param {string} subtitle @param {string} action */
const pageHeading = (title, subtitle, action) => `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action}</div>`;
/** @param {string} title @param {string} description @param {string} [action] */
const emptyState = (title, description, action = '') => `<div class="empty-state">${icon('book')}<h3>${title}</h3><p>${description}</p>${action}</div>`;
/** @param {string} source */
const sourceLink = source => safeUrl(source) ? `<a class="source-link" href="${esc(safeUrl(source))}" target="_blank" rel="noopener noreferrer">查看原始来源 ${icon('external')}</a>` : '<span class="muted">尚未登记来源</span>';
/** @param {string} stage */
const stageBadge = stage => `<span class="stage stage-${esc(stage)}">${esc(stage)}</span>`;
/** @param {string} value @param {string} label @param {string} [selected] */
const option = (value, label, selected = '') => `<option value="${esc(value)}" ${selected === value ? 'selected' : ''}>${esc(label)}</option>`;

function shell() {
  const counts = { overview: '', models: data.models.length, experiments: data.experiments.length, frontier: data.notes.length, deliverables: data.artifacts.length || '' };
  app.innerHTML = `<div class="workspace ${mobileNav ? 'nav-open' : ''}"><aside class="sidebar"><a class="brand" href="#overview"><img src="./assets/prism.svg" alt="" width="35" height="35"><span>Prism<span class="brand-caption">多模态研究工作台</span></span></a><div class="workspace-label"><span class="workspace-dot">F</span><span>FDE 研究空间</span><span class="personal">个人版</span></div><nav aria-label="工作台导航">${pages.map(key => `<a href="#${key}" class="nav-item ${page === key ? 'active' : ''}" ${page === key ? 'aria-current="page"' : ''}>${icon(key)}<span>${labels[key]}</span><span class="nav-count">${counts[key]}</span></a>`).join('')}</nav><div class="sidebar-topics"><p class="sidebar-caption">研究方向</p>${domains.map((d, i) => `<button data-action="domain-nav" data-id="${d}" class="topic-nav"><span class="topic-dot topic-${i}"></span>${d === '图片' ? '图像与视觉' : d === 'CAD' ? 'CAD 与空间' : '视频与世界模型'}<span>${data.models.filter(m => m.domain === d).length}</span></button>`).join('')}</div><div class="sidebar-bottom"><div class="local-status">${icon('check')}<span>记录保存在此浏览器</span></div><div class="backup-actions"><button data-action="backup">${icon('download')}备份</button><button data-action="import">${icon('upload')}恢复</button></div><div class="profile"><span class="avatar">陈</span><div><strong>我的研究空间</strong><span>发现 · 验证 · 交付</span></div><button class="icon-button" data-action="about" aria-label="关于工作台">${icon('info')}</button></div></div></aside><div class="main-shell"><header class="topbar"><div class="breadcrumb"><button class="icon-button mobile-menu" data-action="menu" aria-label="打开导航">${icon('menu')}</button><span>工作空间</span>${icon('chevron')}<strong>${labels[page]}</strong></div><div class="top-actions"><button class="global-search" data-action="search">${icon('search')}<span>搜索研究内容</span><kbd>Ctrl K</kbd></button><span class="prototype-label">本地原型</span><span class="small-avatar">陈</span></div></header><main id="main" tabindex="-1">${storageError ? `<div class="error-banner" role="alert">${esc(storageError)}<button data-action="raw-backup">导出原始记录</button><button data-action="import">恢复备份</button></div>` : ''}${content()}</main><footer class="workspace-footer"><span>Prism Research Studio</span><span>示例档案与虚构实验用于展示流程，未连接模型推理服务。</span></footer></div></div>`;
}
function content() {
  if (page === 'models') return modelsPage();
  if (page === 'experiments') return experimentsPage();
  if (page === 'frontier') return frontierPage();
  if (page === 'deliverables') return deliverablesPage();
  return overviewPage();
}
function overviewPage() {
  const focus = data.models.find(m => m.id === 'neural-cad') ?? data.models[0];
  const featured = domains.map(d => data.models.find(m => m.domain === d)).filter(m => m !== undefined);
  return `${pageHeading('每一次探索，都有所沉淀。', '连接前沿技术、实验发现与下一份交付。', `<button class="button primary" data-action="new-model">${icon('plus')}记录模型</button>`)}<div class="overview-layout"><div class="overview-main"><section class="focus-banner"><div class="focus-copy"><span class="focus-tag">${icon('spark')}本周研究焦点</span><h2>从设计意图，<br>到可编辑的几何。</h2><p>探索 CAD 生成的下一步：<br>精度、约束，以及真正可用的设计。</p><button class="button hero-button" data-action="${focus ? 'detail' : 'new-model'}" ${focus ? `data-id="${esc(focus.id)}"` : ''}>${focus ? '继续研究' : '开始记录'}${icon('book')}</button></div><div class="focus-visual">${artwork('CAD', true)}<span class="visual-caption">Geometry study / CAD</span></div><span class="focus-issue">研究专题 · CAD</span></section><div class="section-heading"><div><h2>能力探索</h2><span>三个方向，持续深入</span></div><a href="#models">全部模型 ${icon('chevron')}</a></div><div class="model-grid overview-models">${featured.map(modelCard).join('') || emptyState('开始建立模型档案', '记录第一个值得研究的模型。')}</div><div class="section-heading recent-heading"><div><h2>最近的实验</h2><span>让每一个判断都有依据</span></div><a href="#experiments">实验记录 ${icon('chevron')}</a></div><section class="recent-list">${data.experiments.slice(0, 3).map(e => `<button class="recent-experiment" data-action="experiment-detail" data-id="${esc(e.id)}"><span class="experiment-icon">${icon('experiments')}</span><span class="recent-copy"><strong>${esc(e.title)}${e.demo ? '<span class="demo-label">演示</span>' : ''}</strong><span>${esc(data.models.find(m => m.id === e.modelId)?.name ?? '')} · ${esc(e.task)}</span></span><span class="recent-date">${esc(e.date.slice(5))}</span>${icon('chevron')}</button>`).join('') || emptyState('还没有实验', '从真实样本和明确的成功标准开始。')}</section></div><aside class="research-aside"><section class="research-pulse"><div class="section-heading compact"><h2>研究脉搏</h2><span class="today-label">${today().slice(5).replace('-', ' / ')}</span></div><div class="pulse-row"><span>已收录模型</span><strong>${String(data.models.length).padStart(2, '0')}<small>个</small></strong></div><div class="pulse-row"><span>实验记录</span><strong>${String(data.experiments.length).padStart(2, '0')}<small>次</small></strong></div><div class="pulse-row"><span>交付成果</span><strong>${String(data.artifacts.length).padStart(2, '0')}<small>份</small></strong></div><div class="domain-spectrum">${domains.map((d, i) => `<span class="spectrum-${i}" style="flex:${Math.max(1, data.models.filter(m => m.domain === d).length)}"></span>`).join('')}</div><div class="spectrum-legend"><span>图片</span><span>CAD</span><span>视频</span></div></section><section class="field-notes"><div class="section-heading compact"><h2>前沿手记</h2><button class="icon-button" data-action="new-note" aria-label="新增前沿手记">${icon('plus')}</button></div>${data.notes.slice(0, 3).map(n => `<button class="note-snippet" data-action="note-detail" data-id="${esc(n.id)}"><span class="note-domain">${n.domain} / ${esc(n.stage)}</span><strong>${esc(n.title)}</strong><span class="note-date">${esc(n.date.slice(5))}</span></button>`).join('') || '<p class="muted">把值得追踪的问题记在这里。</p>'}<a class="all-notes" href="#frontier">打开前沿追踪 ${icon('chevron')}</a></section><section class="deliver-prompt"><span class="paper-symbol">${icon('deliverables')}</span><h3>让研究成为交付。</h3><p>把模型档案与实验结论，<br>整理成一份清晰的报告。</p><button class="button" data-action="new-report">创建交付物${icon('plus')}</button></section></aside></div>`;
}
function filteredModels() {
  const term = query.trim().toLowerCase();
  return data.models.filter(m => (domainFilter === '全部' || m.domain === domainFilter) && (capabilityFilter === '全部能力' || m.capabilities.includes(capabilityFilter)) && (stageFilter === '全部状态' || m.stage === stageFilter) && (!favoritesOnly || m.favorite) && (!term || [m.name, m.vendor, m.summary, m.route, m.notes].join(' ').toLowerCase().includes(term)));
}
function modelsPage() {
  return `${pageHeading('模型档案', '把模型能力、技术路线与验证边界，记录在同一个地方。', `<button class="button primary" data-action="new-model">${icon('plus')}记录模型</button>`)}<div class="filter-bar"><div class="domain-tabs" role="group" aria-label="按研究领域筛选">${['全部', ...domains].map(d => `<button class="${domainFilter === d ? 'selected' : ''}" data-action="filter-domain" data-id="${d}" aria-pressed="${domainFilter === d}">${d}<span>${d === '全部' ? data.models.length : data.models.filter(m => m.domain === d).length}</span></button>`).join('')}</div><button class="button subtle ${favoritesOnly ? 'selected' : ''}" data-action="favorites" aria-pressed="${favoritesOnly}">${icon('star')}仅看关注</button></div><div class="list-tools"><label class="inline-search">${icon('search')}<input id="model-query" type="search" placeholder="搜索名称、厂商或技术路线" value="${esc(query)}" aria-label="筛选模型"></label><label class="select-label"><span class="sr-only">能力类型</span><select id="capability-filter">${['全部能力', '生成编辑', '识别理解'].map(v => option(v, v, capabilityFilter)).join('')}</select></label><label class="select-label"><span class="sr-only">研究状态</span><select id="stage-filter">${['全部状态', ...stages].map(v => option(v, v, stageFilter)).join('')}</select></label><span class="result-count" id="model-count">${filteredModels().length} 个模型</span></div><div id="model-results" class="model-grid library-grid">${modelResults()}</div>`;
}
function modelResults() { return filteredModels().map(modelCard).join('') || emptyState('没有找到相关模型', '试试其他关键词，或清除筛选条件。', '<button class="button" data-action="clear-filters">清除筛选</button>'); }
function experimentsPage() {
  const displayed = comparedIds.length ? data.experiments.filter(e => comparedIds.includes(e.modelId)) : data.experiments;
  return `${pageHeading('让结论，经得起验证。', '记录样本、结果与失败案例。不同测试条件下的成绩不直接排名。', `<button class="button primary" data-action="new-experiment">${icon('plus')}记录实验</button>`)}<section class="comparison-strip"><div><span class="round-icon">${icon('models')}</span><div><h2>建立你的比较视角</h2><p>选择模型，查看它们已有的实验依据。</p></div></div><div class="compare-picks">${data.models.map(m => `<button class="model-chip ${comparedIds.includes(m.id) ? 'selected' : ''}" data-action="compare-model" data-id="${esc(m.id)}" aria-pressed="${comparedIds.includes(m.id)}">${comparedIds.includes(m.id) ? icon('check') : icon('plus')}${esc(m.name)}</button>`).join('')}</div></section><div class="section-heading"><h2>实验日志 <span class="muted count-inline">${displayed.length}</span></h2><button class="button subtle" data-action="new-report" data-kind="模型对比报告">${icon('deliverables')}生成对比报告</button></div><div class="experiment-grid">${displayed.map(e => { const m = data.models.find(m => m.id === e.modelId); return `<article class="experiment-card"><div class="experiment-card-top"><span class="domain-label">${esc(m?.domain ?? '')} · ${esc(e.task)}</span>${e.demo ? '<span class="demo-label">虚构演示</span>' : '<span class="user-label">用户记录</span>'}</div><button class="title-button" data-action="experiment-detail" data-id="${esc(e.id)}">${esc(e.title)}</button><p class="experiment-model">${esc(m?.name ?? '')} <span>${esc(e.date)}</span></p><div class="experiment-metrics"><div><strong>${(e.successCount / e.sampleSize * 100).toFixed(0)}<small>%</small></strong><span>按记录标准的成功率</span></div><div><strong>${e.sampleSize}<small>份</small></strong><span>样本数量</span></div><div><strong>${e.latency ?? '—'}<small>${e.latency === null ? '' : 's'}</small></strong><span>单次耗时</span></div></div><p class="experiment-conclusion">${esc(e.conclusion)}</p><div class="experiment-card-bottom"><span>${esc(e.dataset)}</span><button class="text-button" data-action="experiment-detail" data-id="${esc(e.id)}">查看记录 ${icon('chevron')}</button></div></article>`; }).join('') || emptyState('还没有相关实验记录', '选择一个模型，录入你实际执行过的验证结果。', '<button class="button" data-action="new-experiment">记录实验</button>')}</div>`;
}
function frontierPage() {
  return `${pageHeading('追踪变化，也记录思考。', '让论文、技术动态与待验证的问题，沿着研究进程持续推进。', `<button class="button primary" data-action="new-note">${icon('plus')}新增研究手记</button>`)}<div class="frontier-banner">${icon('frontier')}<div><strong>从值得关注，到值得投入</strong><p>每条手记保留原始来源与下一步问题。这里的状态由你判断和维护。</p></div></div><div class="kanban">${stages.map(s => `<section class="kanban-column"><div class="kanban-heading"><h2>${s}</h2><span>${data.notes.filter(n => n.stage === s).length}</span></div>${data.notes.filter(n => n.stage === s).map(n => `<article class="research-note"><span class="domain-label">${n.domain}</span><button class="title-button" data-action="note-detail" data-id="${esc(n.id)}">${esc(n.title)}</button><p>${esc(n.body)}</p><div class="note-card-bottom"><span>${esc(n.date.slice(5))}${n.demo ? ' · 示例' : ''}</span><button class="icon-button" data-action="edit-note" data-id="${esc(n.id)}" aria-label="编辑 ${esc(n.title)}">${icon('edit')}</button></div><label class="note-stage"><span class="sr-only">${esc(n.title)}的状态</span><select data-note-stage="${esc(n.id)}">${stages.map(v => option(v, v, s)).join('')}</select></label></article>`).join('') || '<div class="kanban-empty">等待下一条发现</div>'}</section>`).join('')}</div>`;
}
function deliverablesPage() {
  return `${pageHeading('研究的下一站，是交付。', '从已有记录整理草稿，保留来源、证据与尚待确认的部分。', `<button class="button primary" data-action="new-report">${icon('plus')}创建交付物</button>`)}<div class="template-grid">${kinds.map((k, i) => `<button class="template-card template-${i}" data-action="new-report" data-kind="${k}"><span class="template-icon">${icon(['book', 'models', 'deliverables', 'frontier'][i])}</span><h2>${k}</h2><p>${['整理本期进展、实验发现与下周计划', '汇总候选模型与可比的实验依据', '把技术能力连接到客户的业务流程', '梳理技术路线、资料来源与开放问题'][i]}</p><span class="template-use">使用模板 ${icon('plus')}</span></button>`).join('')}</div><div class="section-heading"><h2>我的交付物 <span class="muted count-inline">${data.artifacts.length}</span></h2><span class="muted">可编辑 · Markdown / HTML · 打印为 PDF</span></div><div class="artifact-list">${data.artifacts.length ? data.artifacts.map(a => `<article class="artifact-row"><span class="artifact-icon">${icon('deliverables')}</span><div><button class="title-button" data-action="artifact" data-id="${esc(a.id)}">${esc(a.title)}</button><p>${esc(a.kind)} · ${a.modelIds.length} 个模型 · ${esc(a.date)}</p></div><span class="stage stage-研究中">待复核草稿</span><button class="button" data-action="artifact" data-id="${esc(a.id)}">打开文档${icon('edit')}</button><button class="icon-button" data-action="export-md" data-id="${esc(a.id)}" aria-label="导出 ${esc(a.title)}">${icon('download')}</button></article>`).join('') : emptyState('你的第一份交付物，从这里开始。', '选择上方模板，将模型档案和实验结果整理成可编辑的草稿。')}</div><div class="delivery-note">${icon('info')}草稿使用本地模板整理，不调用 AI。虚构演示实验会自动从报告的验证结果中排除。</div>`;
}
/** @param {string} html @param {string} [className] */
function openDialog(html, className = '') {
  if (hasUnsavedDocument() && !confirm('文档有尚未保存的修改。确定离开并放弃这些修改吗？')) return;
  modal.className = className; modal.innerHTML = html;
  if (!modal.open) modal.showModal();
  const heading = modal.querySelector('h2');
  modal.setAttribute('aria-label', heading?.textContent || '研究记录');
  requestAnimationFrame(() => { const target = modal.querySelector('[autofocus]'); if (target instanceof HTMLElement) target.focus(); });
}
/** @param {string} title @param {string} sub @param {string} body @param {string} formType @param {string} [id] */
function formDialog(title, sub, body, formType, id = '') {
  openDialog(`<div class="modal-header"><div><h2>${title}</h2><p>${sub}</p></div>${buttonClose('编辑')}</div><form data-form="${formType}" data-id="${esc(id)}"><div class="form-body">${body}<p class="form-error" role="alert"></p></div><div class="modal-footer"><button class="button" type="button" data-action="close">取消</button><button class="button primary" type="submit">${icon('check')}${formType === 'report' ? '生成草稿' : '保存记录'}</button></div></form>`, 'form-modal');
}
/** @param {string} label @param {string} name @param {string} [value] @param {string} [extra] */
const input = (label, name, value = '', extra = '') => `<label class="field"><span>${label}</span><input name="${name}" value="${esc(value)}" ${extra}></label>`;
/** @param {string} label @param {string} name @param {string} [value] @param {string} [extra] */
const textarea = (label, name, value = '', extra = '') => `<label class="field"><span>${label}</span><textarea name="${name}" rows="3" ${extra}>${esc(value)}</textarea></label>`;
/** @param {string} [id] */
function modelForm(id = '') {
  const m = data.models.find(m => m.id === id);
  formDialog(m ? '编辑模型档案' : '记录一个值得研究的模型', '先记录已知信息，再通过实验逐步补齐。', `<div class="form-grid">${input('模型名称 *', 'name', m?.name, 'required maxlength="120" autofocus')}${input('厂商 / 团队', 'vendor', m?.vendor, 'maxlength="120"')}<label class="field"><span>研究领域</span><select name="domain">${domains.map(d => option(d, d, m?.domain)).join('')}</select></label><label class="field"><span>研究状态</span><select name="stage">${stages.map(s => option(s, s, m?.stage)).join('')}</select></label></div><fieldset class="capability-field"><legend>能力方向（至少选择一项）</legend>${['生成编辑', '识别理解'].map(c => `<label><input type="checkbox" name="capabilities" value="${c}" ${m ? m.capabilities.includes(c) ? 'checked' : '' : 'checked'}>${c}</label>`).join('')}</fieldset>${textarea('能力摘要 *', 'summary', m?.summary, 'required maxlength="1000"')}${input('核心技术路线', 'route', m?.route, 'placeholder="例如：视觉语言模型 / 参数化代码生成" maxlength="300"')}<div class="form-grid">${input('接入 / 部署方式', 'access', m?.access, 'placeholder="未核实可留空" maxlength="300"')}${input('商业许可', 'license', m?.license, 'placeholder="待核实" maxlength="300"')}</div>${input('官方资料 / 论文来源', 'source', m?.source, 'type="url" placeholder="https://…" maxlength="2000"')}${textarea('研究笔记与待验证问题', 'notes', m?.notes, 'maxlength="10000"')}${m?.demo ? '<p class="form-hint">此档案来自示例。保存后将标记为用户记录，事实仍需核实。</p>' : ''}`, 'model', id);
}
/** @param {string} id */
function modelDetail(id) {
  const m = data.models.find(m => m.id === id); if (!m) return;
  const experiments = data.experiments.filter(e => e.modelId === id);
  openDialog(`<div class="detail-art ${m.domain === 'CAD' ? 'art-cad' : m.domain === '图片' ? 'art-image' : 'art-video'}">${artwork(m.domain)}<span class="detail-domain">${m.domain} / ${esc(m.route)}</span>${buttonClose('模型详情')}</div><div class="detail-content"><div class="detail-title"><div><p class="model-vendor">${esc(m.vendor)}</p><h2>${esc(m.name)}</h2></div>${stageBadge(m.stage)}</div><p class="detail-summary">${esc(m.summary)}</p><div class="detail-capabilities">${m.capabilities.map(c => `<span class="model-chip selected">${c}</span>`).join('')}${m.demo ? '<span class="demo-label">示例资料 · 待核实</span>' : '<span class="user-label">用户记录 · 待复核</span>'}</div><dl class="detail-facts"><div><dt>技术路线</dt><dd>${esc(m.route || '待补充')}</dd></div><div><dt>接入与部署</dt><dd>${esc(m.access || '待核实')}</dd></div><div><dt>商业许可</dt><dd>${esc(m.license || '待核实')}</dd></div><div><dt>记录日期</dt><dd>${esc(m.updated)}</dd></div></dl><section class="detail-notes"><h3>研究笔记</h3><p>${esc(m.notes || '还没有研究笔记，记录你的第一个问题。')}</p></section><section class="detail-notes"><h3>相关实验 <span class="muted">${experiments.length}</span></h3>${experiments.map(e => `<button class="detail-experiment" data-action="experiment-detail" data-id="${esc(e.id)}">${icon('experiments')}<span>${esc(e.title)}</span>${e.demo ? '<span class="demo-label">演示</span>' : ''}${icon('chevron')}</button>`).join('') || '<p class="muted">尚无实验记录，暂不能判断实际效果。</p>'}</section>${sourceLink(m.source)}</div><div class="modal-footer"><button class="button" data-action="new-experiment" data-id="${esc(id)}">${icon('experiments')}记录实验</button><button class="button primary" data-action="edit-model" data-id="${esc(id)}">${icon('edit')}编辑档案</button></div>`, 'detail-modal');
}
/** @param {string} [modelId] @param {string} [id] */
function experimentForm(modelId = '', id = '') {
  if (!data.models.length) { toast('请先创建模型档案。'); modelForm(); return; }
  const e = data.experiments.find(e => e.id === id);
  formDialog(e ? '编辑实验记录' : '记录一次真实的验证', '此处记录已执行的实验，不会调用模型。请保留失败案例。', `${input('实验标题 *', 'title', e?.title, 'required autofocus maxlength="200"')}<div class="form-grid"><label class="field"><span>被测模型</span><select name="modelId">${data.models.map(m => option(m.id, m.name, e?.modelId || modelId)).join('')}</select></label><label class="field"><span>任务类型</span><select name="task">${['识别理解', '生成编辑'].map(t => option(t, t, e?.task)).join('')}</select></label></div>${input('样本集 / 数据说明 *', 'dataset', e?.dataset, 'required maxlength="1000" placeholder="记录样本来源、范围与版本"')}<div class="form-grid">${input('样本数量 *', 'sampleSize', String(e?.sampleSize ?? ''), 'type="number" min="1" max="10000000" step="1" required')}${input('成功数量 *', 'successCount', String(e?.successCount ?? ''), 'type="number" min="0" max="10000000" step="1" required')}${input('单次耗时（秒，可选）', 'latency', e?.latency == null ? '' : String(e.latency), 'type="number" min="0" step="any"')}${input('单次成本（元，可选）', 'cost', e?.cost == null ? '' : String(e.cost), 'type="number" min="0" step="any"')}</div>${textarea('成功标准与实验结论 *', 'conclusion', e?.conclusion, 'required maxlength="10000"')}${textarea('限制与失败案例 *', 'limitations', e?.limitations, 'required maxlength="10000"')}${e?.demo ? '<label class="acknowledge"><input type="checkbox" name="confirm-real" required>我已将演示内容替换为真实实验记录。</label>' : ''}`, 'experiment', id);
}
/** @param {string} id */
function experimentDetail(id) {
  const e = data.experiments.find(e => e.id === id); if (!e) return;
  openDialog(`<div class="modal-header"><div><p class="eyebrow">实验记录 ${e.demo ? ' / 虚构演示' : ''}</p><h2>${esc(e.title)}</h2></div>${buttonClose('实验')}</div><div class="detail-content"><p class="detail-summary">${esc(data.models.find(m => m.id === e.modelId)?.name ?? '')} · ${esc(e.task)} · ${esc(e.date)}</p>${e.demo ? '<p class="warning-note">此实验为虚构演示，所有数字不能作为模型评估或选型依据。</p>' : ''}<dl class="detail-facts"><div><dt>样本集</dt><dd>${esc(e.dataset)}</dd></div><div><dt>成功 / 总数</dt><dd>${e.successCount} / ${e.sampleSize}（${(e.successCount / e.sampleSize * 100).toFixed(1)}%）</dd></div><div><dt>单次耗时</dt><dd>${e.latency === null ? '未记录' : e.latency + ' 秒'}</dd></div><div><dt>单次成本</dt><dd>${e.cost === null ? '未记录' : e.cost + ' 元'}</dd></div></dl><section class="detail-notes"><h3>结论与成功标准</h3><p>${esc(e.conclusion)}</p></section><section class="detail-notes"><h3>限制与失败案例</h3><p>${esc(e.limitations)}</p></section></div><div class="modal-footer"><button class="button primary" data-action="edit-experiment" data-id="${esc(id)}">${icon('edit')}编辑记录</button></div>`, 'detail-modal');
}
/** @param {string} [id] */
function noteForm(id = '') {
  const n = data.notes.find(n => n.id === id);
  formDialog(n ? '编辑研究手记' : '留下一条新的发现', '记录技术方向、原始资料和你想进一步验证的问题。', `${input('研究标题 *', 'title', n?.title, 'required autofocus maxlength="200"')}<div class="form-grid"><label class="field"><span>研究领域</span><select name="domain">${domains.map(d => option(d, d, n?.domain)).join('')}</select></label><label class="field"><span>研究状态</span><select name="stage">${stages.map(s => option(s, s, n?.stage)).join('')}</select></label></div>${textarea('观察、问题与下一步 *', 'body', n?.body, 'required maxlength="20000" rows="7"')}${input('原始来源', 'source', n?.source, 'type="url" placeholder="https://…" maxlength="2000"')}`, 'note', id);
}
/** @param {string} id */
function noteDetail(id) {
  const n = data.notes.find(n => n.id === id); if (!n) return;
  openDialog(`<div class="modal-header"><div><p class="eyebrow">${n.domain} / 研究手记${n.demo ? ' / 示例' : ''}</p><h2>${esc(n.title)}</h2></div>${buttonClose('手记')}</div><div class="detail-content">${stageBadge(n.stage)}<div class="note-detail-body">${esc(n.body)}</div>${sourceLink(n.source)}<p class="muted">记录日期：${esc(n.date)}</p></div><div class="modal-footer"><button class="button primary" data-action="edit-note" data-id="${esc(id)}">${icon('edit')}编辑手记</button></div>`, 'detail-modal');
}
/** @param {string} [kind] */
function reportForm(kind = '研究周报') {
  if (!data.models.length) { toast('先记录模型，再创建交付物。'); modelForm(); return; }
  const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - 6);
  const start = kind === '研究周报' ? weekStart.toLocaleDateString('sv-SE') : '';
  const end = kind === '研究周报' ? today() : '';
  formDialog('创建一份交付物', '选取研究范围，系统按模板整理为可编辑草稿。', `<label class="field"><span>交付物类型</span><select name="kind">${kinds.map(k => option(k, k, kind)).join('')}</select></label>${input('文档标题 *', 'title', `多模态 AI ${kind} · ${today()}`, 'required autofocus maxlength="200"')}<div class="form-grid">${input('记录开始日期（可选）', 'start', start, 'type="date"')}${input('记录结束日期（可选）', 'end', end, 'type="date"')}</div><fieldset class="report-model-picker"><legend>纳入哪些模型？（至少选择一项）</legend>${data.models.map(m => `<label><input type="checkbox" name="modelIds" value="${esc(m.id)}" ${!comparedIds.length || comparedIds.includes(m.id) ? 'checked' : ''}><span><strong>${esc(m.name)}</strong><small>${m.domain} / ${esc(m.stage)}</small></span>${m.demo ? '<span class="demo-label">示例</span>' : ''}</label>`).join('')}</fieldset><div class="form-hint">日期筛选实验与手记，模型档案使用当前快照。虚构演示成绩会被排除；生成后请补充业务背景，并核实来源。</div>`, 'report');
}
/** @param {string} id */
function artifactDetail(id) {
  const a = data.artifacts.find(a => a.id === id); if (!a) return;
  openDialog(`<div class="modal-header"><div><p class="eyebrow">${esc(a.kind)} / 待复核草稿</p><h2>${esc(a.title)}</h2></div>${buttonClose('文档')}</div><div class="document-toolbar"><span>修改后请保存；导出会使用编辑区当前内容。</span><div><button class="button subtle" data-action="export-md" data-id="${esc(id)}">${icon('download')}Markdown</button><button class="button subtle" data-action="export-html" data-id="${esc(id)}">${icon('download')}HTML</button><button class="button subtle" data-action="print-report" data-id="${esc(id)}">${icon('print')}打印 / PDF</button></div></div><div class="document-workspace"><label class="document-editor"><span>Markdown 编辑</span><textarea id="document-content" data-id="${esc(id)}" spellcheck="false">${esc(a.content)}</textarea></label><article class="document-preview"><span class="preview-caption">文档预览</span><div id="document-preview-content" class="report-content">${renderMarkdown(a.content)}</div></article></div><div class="modal-footer"><span class="muted" id="save-indicator">已保存到此浏览器</span><button class="button primary" data-action="save-artifact" data-id="${esc(id)}">${icon('check')}保存修改</button></div>`, 'document-modal');
}

function searchDialog() {
  openDialog(`<div class="search-modal-head">${icon('search')}<input id="global-query" placeholder="搜索模型、实验、手记和交付物" aria-label="全局搜索" autofocus>${buttonClose('搜索')}</div><div id="global-results" class="global-results"><p class="muted">输入关键词，找到你记录过的线索。</p></div><div class="search-hint">支持模型名称、摘要、技术路线与记录内容</div>`, 'search-modal');
}
/** @param {string} term */
function updateGlobalSearch(term) {
  const lower = term.trim().toLowerCase();
  const target = document.querySelector('#global-results'); if (!target) return;
  if (!lower) { target.innerHTML = '<p class="muted">输入关键词，找到你记录过的线索。</p>'; return; }
  const results = [
    ...data.models.filter(m => [m.name, m.summary, m.route, m.notes].join(' ').toLowerCase().includes(lower)).map(m => ({ title: m.name, type: '模型档案', action: 'detail', id: m.id })),
    ...data.experiments.filter(e => [e.title, e.conclusion, e.dataset].join(' ').toLowerCase().includes(lower)).map(e => ({ title: e.title, type: '实验记录', action: 'experiment-detail', id: e.id })),
    ...data.notes.filter(n => [n.title, n.body].join(' ').toLowerCase().includes(lower)).map(n => ({ title: n.title, type: '研究手记', action: 'note-detail', id: n.id })),
    ...data.artifacts.filter(a => [a.title, a.content].join(' ').toLowerCase().includes(lower)).map(a => ({ title: a.title, type: '交付物', action: 'artifact', id: a.id }))
  ];
  target.innerHTML = results.length ? results.slice(0, 30).map(r => `<button class="search-result" data-action="${r.action}" data-id="${esc(r.id)}"><span><strong>${esc(r.title)}</strong><small>${r.type}</small></span>${icon('chevron')}</button>`).join('') : emptyState('没有找到相关记录', '试试更短的关键词。');
}
/** @param {string} id */
function currentDocument(id) {
  const editor = document.querySelector('#document-content');
  return editor instanceof HTMLTextAreaElement && editor.dataset.id === id ? editor.value : data.artifacts.find(a => a.id === id)?.content ?? '';
}
function hasUnsavedDocument() {
  if (!modal.open) return false;
  const editor = modal.querySelector('#document-content');
  if (!(editor instanceof HTMLTextAreaElement)) return false;
  return editor.value !== data.artifacts.find(a => a.id === editor.dataset.id)?.content;
}
function closeDialog() {
  if (!hasUnsavedDocument() || confirm('文档有尚未保存的修改。确定关闭并放弃这些修改吗？')) modal.close();
}
/** @param {string} id @param {string} format */
function exportArtifact(id, format) {
  const a = data.artifacts.find(a => a.id === id); if (!a) return;
  const content = currentDocument(id);
  if (format === 'md') download(a.title + '.md', content, 'text/markdown;charset=utf-8');
  else download(a.title + '.html', reportHtml(a.title, content), 'text/html;charset=utf-8');
  toast('已导出文档。');
}
/** @param {string} id */
function printArtifact(id) {
  const a = data.artifacts.find(a => a.id === id); if (!a) return;
  const frame = document.createElement('iframe'); frame.className = 'print-frame'; frame.title = '交付文档打印预览';
  frame.srcdoc = reportHtml(a.title, currentDocument(id));
  frame.addEventListener('load', () => {
    const win = frame.contentWindow; if (!win) { frame.remove(); return; }
    win.addEventListener('afterprint', () => frame.remove(), { once: true });
    win.focus(); win.print();
  }, { once: true });
  document.body.append(frame);
}

document.addEventListener('click', event => {
  if (!(event.target instanceof Element)) return;
  const target = event.target.closest('[data-action]'); if (!(target instanceof HTMLElement)) return;
  const { action, id = '' } = target.dataset;
  if (action === 'close') { closeDialog(); return; }
  if (action === 'menu') { mobileNav = !mobileNav; shell(); return; }
  if (action === 'search') { searchDialog(); return; }
  if (action === 'new-model') { modelForm(); return; }
  if (action === 'edit-model') { modelForm(id); return; }
  if (action === 'detail') { modelDetail(id); return; }
  if (action === 'new-experiment') { experimentForm(id); return; }
  if (action === 'edit-experiment') { experimentForm('', id); return; }
  if (action === 'experiment-detail') { experimentDetail(id); return; }
  if (action === 'new-note') { noteForm(); return; }
  if (action === 'edit-note') { noteForm(id); return; }
  if (action === 'note-detail') { noteDetail(id); return; }
  if (action === 'new-report') { reportForm(target.dataset.kind); return; }
  if (action === 'artifact') { artifactDetail(id); return; }
  if (action === 'favorite') { if (commit(next => { const m = next.models.find(m => m.id === id); if (m) m.favorite = !m.favorite; })) shell(); return; }
  if (action === 'filter-domain') { domainFilter = id; shell(); return; }
  if (action === 'domain-nav') { domainFilter = id; query = ''; capabilityFilter = '全部能力'; stageFilter = '全部状态'; favoritesOnly = false; if (page === 'models') shell(); else location.hash = 'models'; return; }
  if (action === 'favorites') { favoritesOnly = !favoritesOnly; shell(); return; }
  if (action === 'clear-filters') { domainFilter = '全部'; capabilityFilter = '全部能力'; stageFilter = '全部状态'; query = ''; favoritesOnly = false; shell(); return; }
  if (action === 'compare-model') { comparedIds = comparedIds.includes(id) ? comparedIds.filter(v => v !== id) : [...comparedIds, id]; shell(); return; }
  if (action === 'export-md' || action === 'export-html') { exportArtifact(id, action === 'export-md' ? 'md' : 'html'); return; }
  if (action === 'print-report') { printArtifact(id); return; }
  if (action === 'save-artifact') {
    const text = currentDocument(id);
    if (text.length > 200000) { toast('文档超过 20 万字符，请拆分后保存。'); return; }
    if (commit(next => { const a = next.artifacts.find(a => a.id === id); if (a) a.content = text; })) { const indicator = document.querySelector('#save-indicator'); if (indicator) indicator.textContent = '已保存到此浏览器'; toast('文档已保存。'); }
    return;
  }
  if (action === 'backup') { download(`Prism-研究备份-${today()}.json`, JSON.stringify(data, null, 2), 'application/json'); toast('已导出完整备份。'); return; }
  if (action === 'raw-backup') { try { download(`Prism-原始存储-${today()}.txt`, localStorage.getItem('prism-research-workspace-v1') ?? ''); } catch { toast('浏览器阻止读取存储，请检查站点权限。'); } return; }
  if (action === 'import') { fileInput.value = ''; fileInput.click(); return; }
  if (action === 'about') openDialog(`<div class="modal-header"><div><h2>你的研究，有一个安放的地方。</h2><p>Prism · 多模态研究工作台</p></div>${buttonClose('关于')}</div><div class="detail-content"><p>记录图片、CAD 和视频模型，追踪前沿技术，保存实验依据，整理可交付的研究成果。</p><h3>当前版本</h3><p>单人本地原型。数据保存在当前浏览器、当前访问地址下。换浏览器或清除站点数据前，请导出 JSON 备份。</p><p>文档生成使用本地模板；未接入模型推理、自动联网搜集、云端同步或多人协作。示例档案不代表最新模型列表，虚构实验不代表实际成绩。</p><button class="button" data-action="backup">${icon('download')}导出研究备份</button></div>`, 'detail-modal');
});
document.addEventListener('input', event => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.id === 'model-query') {
    query = target.value;
    const results = document.querySelector('#model-results'); if (results) results.innerHTML = modelResults();
    const counter = document.querySelector('#model-count'); if (counter) counter.textContent = `${filteredModels().length} 个模型`;
  }
  if (target instanceof HTMLInputElement && target.id === 'global-query') updateGlobalSearch(target.value);
  if (target instanceof HTMLTextAreaElement && target.id === 'document-content') {
    const preview = document.querySelector('#document-preview-content'); if (preview) preview.innerHTML = renderMarkdown(target.value);
    const indicator = document.querySelector('#save-indicator'); if (indicator) indicator.textContent = '有尚未保存的修改';
  }
});
document.addEventListener('change', event => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) return;
  if (target.id === 'capability-filter') { capabilityFilter = target.value; shell(); }
  if (target.id === 'stage-filter') { stageFilter = target.value; shell(); }
  if (target.dataset.noteStage) {
    const stage = stages.find(s => s === target.value); if (!stage) return;
    if (commit(next => { const n = next.notes.find(n => n.id === target.dataset.noteStage); if (n) { n.stage = stage; n.date = today(); } })) { shell(); toast('研究状态已更新。'); }
  }
});
document.addEventListener('submit', event => {
  const form = event.target; if (!(form instanceof HTMLFormElement)) return;
  // Form controls named "dataset" shadow HTMLFormElement.dataset in browsers.
  const formType = form.getAttribute('data-form'); if (!formType) return;
  event.preventDefault();
  const fields = new FormData(form);
  /** @param {string} key */
  const field = key => String(fields.get(key) ?? '').trim();
  const existingId = form.getAttribute('data-id') ?? '';
  try {
    if (formType === 'model') {
      const capabilities = fields.getAll('capabilities').map(String).filter(c => c === '生成编辑' || c === '识别理解');
      if (!capabilities.length) throw new Error('请至少选择一个能力方向。');
      if (!field('name') || !field('summary')) throw new Error('请填写模型名称和能力摘要。');
      if (field('source') && !safeUrl(field('source'))) throw new Error('来源仅支持 http 或 https 链接。');
      const domain = domains.find(d => d === field('domain')); const stage = stages.find(s => s === field('stage')); if (!domain || !stage) return;
      const old = data.models.find(m => m.id === existingId);
      /** @type {import('./types').ModelRecord} */
      const m = { id: old?.id ?? uid('model'), name: field('name'), vendor: field('vendor'), domain, stage, capabilities, summary: field('summary'), route: field('route'), access: field('access'), license: field('license') || '待核实', source: field('source'), notes: field('notes'), updated: today(), demo: false, favorite: old?.favorite ?? false };
      if (!commit(next => { const index = next.models.findIndex(item => item.id === m.id); if (index >= 0) next.models[index] = m; else next.models.unshift(m); })) return;
      modal.close(); shell(); toast('模型档案已保存。');
    }
    if (formType === 'experiment') {
      const sampleSize = Number(field('sampleSize')); const successCount = Number(field('successCount'));
      const latency = field('latency') ? Number(field('latency')) : null; const cost = field('cost') ? Number(field('cost')) : null;
      if (!Number.isInteger(sampleSize) || sampleSize < 1 || !Number.isInteger(successCount) || successCount < 0 || successCount > sampleSize) throw new Error('成功数量必须为 0 到样本数量之间的整数。');
      if ([latency, cost].some(v => v !== null && (!Number.isFinite(v) || v < 0))) throw new Error('耗时和成本需要填写非负数字。');
      if (!field('title') || !field('dataset') || !field('conclusion') || !field('limitations')) throw new Error('请完整填写标题、样本说明、结论和限制。');
      if (data.experiments.find(e => e.id === existingId)?.demo && fields.get('confirm-real') !== 'on') throw new Error('请确认已将演示内容替换为真实实验。');
      /** @type {import('./types').Experiment} */
      const e = { id: existingId || uid('exp'), title: field('title'), modelId: field('modelId'), task: field('task'), dataset: field('dataset'), sampleSize, successCount, latency, cost, conclusion: field('conclusion'), limitations: field('limitations'), demo: false, date: today() };
      if (!commit(next => { const index = next.experiments.findIndex(item => item.id === e.id); if (index >= 0) next.experiments[index] = e; else next.experiments.unshift(e); })) return;
      modal.close(); shell(); toast('实验记录已保存。');
    }
    if (formType === 'note') {
      const domain = domains.find(d => d === field('domain')); const stage = stages.find(s => s === field('stage')); if (!domain || !stage) return;
      if (!field('title') || !field('body')) throw new Error('请填写标题和研究内容。');
      if (field('source') && !safeUrl(field('source'))) throw new Error('来源仅支持 http 或 https 链接。');
      /** @type {import('./types').ResearchNote} */
      const n = { id: existingId || uid('note'), title: field('title'), domain, stage, body: field('body'), source: field('source'), date: today(), demo: false };
      if (!commit(next => { const index = next.notes.findIndex(item => item.id === n.id); if (index >= 0) next.notes[index] = n; else next.notes.unshift(n); })) return;
      modal.close(); shell(); toast('研究手记已保存。');
    }
    if (formType === 'report') {
      const ids = fields.getAll('modelIds').map(String); const kind = kinds.find(k => k === field('kind')); if (!kind) return;
      const title = field('title'); if (!title) throw new Error('请填写文档标题。');
      const content = generateReport(kind, title, ids, data, { start: field('start'), end: field('end') });
      /** @type {import('./types').Artifact} */
      const a = { id: uid('report'), title, kind, modelIds: ids, content, date: today() };
      if (!commit(next => next.artifacts.unshift(a))) return;
      location.hash = 'deliverables'; shell(); artifactDetail(a.id); toast('草稿已生成，请复核并补充。');
    }
  } catch (error) {
    const node = form.querySelector('.form-error'); if (node) node.textContent = error instanceof Error ? error.message : '保存失败，请检查内容。';
  }
});
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0]; if (!file) return;
  if (file.size > 10 * 1024 * 1024) { toast('备份文件超过 10MB，请检查文件。'); return; }
  toast('正在读取研究备份…');
  try {
    const imported = JSON.parse(await file.text());
    if (!isWorkspace(imported)) throw new Error('备份格式无效，现有记录未改变。');
    openDialog(`<div class="modal-header"><div><h2>恢复研究备份</h2><p>请核对备份内容</p></div>${buttonClose('恢复')}</div><div class="detail-content"><p>备份包含 ${imported.models.length} 个模型、${imported.experiments.length} 条实验、${imported.notes.length} 条手记及 ${imported.artifacts.length} 份交付物。</p><p class="warning-note">恢复将替换此浏览器中的全部研究记录。建议先导出当前备份。</p><div class="restore-actions"><button class="button" data-action="${storageError ? 'raw-backup' : 'backup'}">导出当前记录</button><button class="button primary" id="confirm-restore">确认恢复</button></div></div>`, 'detail-modal');
    document.querySelector('#confirm-restore')?.addEventListener('click', () => {
      try { persistWorkspace(imported); data = imported; storageError = ''; comparedIds = []; modal.close(); shell(); toast('研究备份已恢复。'); }
      catch { toast('恢复失败，浏览器存储不可用，当前记录未改变。'); }
    }, { once: true });
  } catch (error) { toast(error instanceof Error ? error.message : '无法读取备份文件。'); }
});
modal.addEventListener('click', event => {
  if (event.target === modal) {
    const rect = modal.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog();
  }
});
modal.addEventListener('cancel', event => {
  if (hasUnsavedDocument()) { event.preventDefault(); closeDialog(); }
});
window.addEventListener('beforeunload', event => {
  if (hasUnsavedDocument()) event.preventDefault();
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchDialog(); }
});
function route() {
  page = pages.find(p => p === location.hash.slice(1)) ?? 'overview'; mobileNav = false;
  shell(); window.scrollTo({ top: 0, behavior: 'instant' });
}
window.addEventListener('hashchange', route);
route();
