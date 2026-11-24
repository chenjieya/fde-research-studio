import { escapeHtml, today } from './workspace.js';
/** 处理表格分隔符和 Markdown 特殊字符，避免输入打乱报告结构。 @param {string} text */
const cell = (text) =>
  text
    .replace(/\|/g, '／')
    .replace(/[\r\n]+/g, ' ')
    .replace(/([\\`*_[\]<>#])/g, '\\$1');
/**
 * 按所选模型和日期整理报告草稿，只把用户录入的实验作为验证记录。
 * @param {import('../types').ReportKind} kind
 * @param {string} title
 * @param {string[]} ids
 * @param {import('../types').Workspace} data
 * @param {{start?: string, end?: string}} [range]
 */
export function generateReport(kind, title, ids, data, range = {}) {
  if (range.start && range.end && range.start > range.end)
    throw new Error('开始日期不能晚于结束日期。');
  /** @param {string} date */
  const inRange = (date) =>
    (!range.start || date >= range.start) && (!range.end || date <= range.end);
  const models = data.models.filter((m) => ids.includes(m.id));
  if (!models.length) throw new Error('请至少选择一个模型。');
  const experiments = data.experiments.filter((e) => ids.includes(e.modelId) && inRange(e.date));
  const real = experiments.filter((e) => !e.demo);
  const selectedDomains = new Set(models.map((m) => m.domain));
  const notes = data.notes.filter(
    (n) => !n.demo && selectedDomains.has(n.domain) && inRange(n.date),
  );
  const lines = [
    `# ${title.replace(/[\r\n]/g, ' ')}`,
    '',
    '[TOC]',
    '',
    '---',
    '',
    '## 修订记录',
    '',
    '| 编号 | 版本 | 修订人 | 修订内容 | 日期 |',
    '|:----|:-----|:------:|:--------|:-----|',
    `| 001 | 1.0 | jie.chen | 生成${kind}草稿 | ${today()} |`,
    '',
    '---',
    '',
    '## 1. 范围与证据',
    '',
    `本报告汇总 ${models.length} 个模型档案、${real.length} 条用户录入的实验记录。`,
    '',
    '生成方式：按已保存资料整理的模板草稿，未经联网核验或模型推理。示例资料和演示实验不作为真实选型证据；用户录入记录也需人工复核。',
    '',
    '---',
    '',
    '## 2. 模型概览',
    '',
    '| 模型 | 领域 | 能力 | 技术路线 | 研究状态 | 证据性质 |',
    '|:-----|:-----|:-----|:---------|:---------|:---------|',
    ...models.map(
      (m) =>
        `| ${cell(m.name)} | ${m.domain} | ${m.capabilities.join('、')} | ${cell(m.route)} | ${m.stage} | ${m.demo ? '示例资料，待核实' : '用户记录，待复核'} |`,
    ),
    '',
    '---',
    '',
    '## 3. 验证记录',
    '',
  ];
  lines.splice(
    lines.indexOf('---', lines.indexOf('## 1. 范围与证据')),
    0,
    `实验与手记的记录日期范围：${range.start || '不限'} 至 ${range.end || '不限'}。模型档案为生成时的当前快照。`,
    '',
  );
  if (!real.length)
    lines.push('暂无用户录入的实验数据。暂不判断模型优劣、生产可用性或投入产出。', '');
  for (const e of real) {
    const model = models.find((m) => m.id === e.modelId);
    lines.push(
      `### 3.${real.indexOf(e) + 1}. ${cell(e.title)}`,
      '',
      `- 模型：${cell(model?.name ?? '')}`,
      `- 样本集：${cell(e.dataset)}；成功 ${e.successCount} / ${e.sampleSize}，成功率 ${((e.successCount / e.sampleSize) * 100).toFixed(1)}%。`,
      `- 单次耗时：${e.latency === null ? '未记录' : `${e.latency} 秒`}；单次成本：${e.cost === null ? '未记录' : `${e.cost} 元`}。`,
      `- 结论：${cell(e.conclusion)}`,
      `- 限制与失败案例：${cell(e.limitations || '待补充')}`,
      '',
    );
  }
  if (experiments.some((e) => e.demo))
    lines.push(
      `另有 ${experiments.filter((e) => e.demo).length} 条虚构演示实验，已从以上数据中排除。`,
      '',
    );
  lines.push(
    '---',
    '',
    '## 4. ' +
      {
        研究周报: '本期进展与下一步',
        模型对比报告: '比较结论与选型条件',
        'FDE 方案草稿': '业务流程与验证计划',
        技术调研简报: '技术路线与待解决问题',
      }[kind],
    '',
  );
  if (kind === 'FDE 方案草稿')
    lines.push(
      '- 目标业务与客户：待补充。',
      '- 当前人工流程、耗时及痛点：待补充。',
      '- 候选流程：数据输入 → 模型处理 → 规则校验 → 人工复核 → 业务系统。',
      '- 接入方式、数据权限与运行环境：待确认。',
      '- 验收指标：基于代表性样本确定质量、延迟、成本及人工返工要求。',
      '- 生产监控、失败处置与负责人：待补充。',
      '',
    );
  else if (kind === '模型对比报告')
    lines.push(
      '模型之间只有在任务、样本、提示词和成功标准一致时才可直接比较。本报告不跨不同实验条件计算总排名。',
      '',
      '- 共同测试集与成功标准：待确认。',
      '- 质量、延迟、成本及可部署性权重：待确认。',
      '- 推荐方案及适用条件：待人工评审。',
      '',
    );
  else
    lines.push(
      ...models.map((m) => `- ${cell(m.name)}：${cell(m.notes || '补充实验样本和评估标准。')}`),
      '',
    );
  if ((kind === '研究周报' || kind === '技术调研简报') && notes.length) {
    lines.push('### 4.1. 相关领域的研究手记', '');
    for (const note of notes)
      lines.push(
        `- ${cell(note.title)}（${note.domain}，${note.stage}）：${cell(note.body)}`,
        `  - 来源：${note.source || '待补充'}；记录日期：${cell(note.date)}。`,
        '',
      );
  }
  lines.push('---', '', '## 5. 来源与待核实事项', '');
  for (const m of models)
    lines.push(
      `- ${cell(m.name)}：${m.source || '尚未登记来源'}；记录日期 ${cell(m.updated)}。`,
      `  - 接入：${cell(m.access)}；许可：${cell(m.license)}。`,
    );
  lines.push('', '请在交付前核实具体模型版本、商业许可、部署条件及所有事实性结论。', '');
  return lines.join('\n');
}
/**
 * 渲染页面需要的少量 Markdown 格式，原始 HTML 会先转义。
 * @param {string} markdown
 */
export function renderMarkdown(markdown) {
  let inTable = false;
  const result = markdown
    .split('\n')
    .map((raw) => {
      const line = escapeHtml(raw);
      if (line.startsWith('|')) {
        if (/^\|[\s:|-]+\|$/.test(raw)) return '';
        const cells = line
          .slice(1, -1)
          .split('|')
          .map((c) => `<td>${c.trim()}</td>`)
          .join('');
        if (!inTable) {
          inTable = true;
          return `<div class="table-scroll"><table><tbody><tr>${cells}</tr>`;
        }
        return `<tr>${cells}</tr>`;
      }
      const close = inTable ? '</tbody></table></div>' : '';
      inTable = false;
      if (/^### /.test(raw)) return close + `<h3>${line.slice(4)}</h3>`;
      if (/^## /.test(raw)) return close + `<h2>${line.slice(3)}</h2>`;
      if (/^# /.test(raw)) return close + `<h1>${line.slice(2)}</h1>`;
      if (raw === '---') return close + '<hr>';
      if (raw === '[TOC]') return close;
      if (raw.startsWith('- ')) return close + `<p class="report-bullet">${line.slice(2)}</p>`;
      return close + (line.trim() ? `<p>${line}</p>` : '');
    })
    .join('');
  return result + (inTable ? '</tbody></table></div>' : '');
}
/**
 * 生成可独立打开、下载或打印的报告 HTML。
 * @param {string} title
 * @param {string} markdown
 */
export function reportHtml(title, markdown) {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{font:16px/1.8 "Microsoft YaHei",sans-serif;color:#202c43;max-width:960px;margin:50px auto;padding:24px}h1{font-size:30px}h2{margin-top:32px}table{border-collapse:collapse;width:100%;font-size:14px}td{border:1px solid #dfe3eb;padding:10px}hr{border:0;border-top:1px solid #dfe3eb;margin:28px 0}p{overflow-wrap:anywhere}.report-bullet{padding-left:16px}.table-scroll{overflow:auto}@media print{body{margin:0}h2{break-after:avoid}tr{break-inside:avoid}}</style><body>${renderMarkdown(markdown)}</body></html>`;
}
