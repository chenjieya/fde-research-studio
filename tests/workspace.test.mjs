import test from 'node:test';
import assert from 'node:assert/strict';
import { isWorkspace, safeUrl, escapeHtml } from '../src/lib/workspace.js';
import { generateReport, renderMarkdown, reportHtml } from '../src/lib/reports.js';

// 仅用于契约与报告测试，生产页面不引用这些记录。
const model = {
  id: 'qwen-vl',
  name: '测试理解模型',
  vendor: '测试厂商',
  domain: '图片',
  capabilities: ['识别理解'],
  stage: '研究中',
  summary: '测试摘要',
  route: 'VLM',
  access: 'API',
  license: '待核实',
  source: 'https://example.com/model',
  updated: '2026-11-24',
  notes: '',
  demo: true,
  favorite: false,
};
const experiment = {
  id: 'test-experiment',
  title: '测试实验',
  modelId: model.id,
  task: '识别理解',
  dataset: '测试样本',
  sampleSize: 10,
  successCount: 8,
  latency: 1,
  cost: 1,
  conclusion: '测试结论',
  limitations: '测试限制',
  date: '2026-11-24',
  demo: true,
};
const initialWorkspace = {
  version: 1,
  models: [model, { ...model, id: 'test-cad', name: 'Neural CAD', domain: 'CAD' }],
  experiments: [experiment, { ...experiment, id: 'test-experiment-2', modelId: 'test-cad' }],
  notes: [
    {
      id: 'test-note',
      title: '测试手记',
      domain: '图片',
      stage: '待调研',
      body: '测试问题',
      source: '',
      date: '2026-11-24',
      demo: true,
    },
  ],
  artifacts: [],
};

test('示例档案满足完整备份契约', () => {
  assert.equal(isWorkspace(initialWorkspace), true);
});
test('拒绝损坏、重复 ID、悬空引用及不合法的实验数字', () => {
  for (const mutate of [
    (d) => {
      d.models[0].name = 42;
    },
    (d) => {
      d.models[0].source = 'javascript:alert(1)';
    },
    (d) => {
      d.models.push(d.models[0]);
    },
    (d) => {
      d.experiments[0].modelId = 'missing';
    },
    (d) => {
      d.experiments[0].successCount = 100;
    },
    (d) => {
      d.experiments[0].latency = -1;
    },
    (d) => {
      d.artifacts.push({
        id: 'x',
        title: 't',
        content: '',
        date: '',
        kind: '研究周报',
        modelIds: ['missing'],
      });
    },
  ]) {
    const data = structuredClone(initialWorkspace);
    mutate(data);
    assert.equal(isWorkspace(data), false);
  }
});
test('交付物排除虚构演示成绩，不伪造选型结论', () => {
  const content = generateReport(
    '模型对比报告',
    '对比',
    initialWorkspace.models.map((m) => m.id),
    initialWorkspace,
  );
  assert.match(content, /暂无用户录入的实验数据/);
  assert.match(content, /2 条虚构演示实验，已从以上数据中排除/);
  assert.doesNotMatch(content, /80\.0%/);
  assert.match(content, /jie.chen/);
});
test('仅纳入已选模型的真实记录，保留零成本和缺失值', () => {
  const data = structuredClone(initialWorkspace);
  data.experiments.push({
    ...data.experiments[0],
    id: 'real',
    demo: false,
    cost: 0,
    latency: null,
  });
  const report = generateReport('研究周报', '周报', ['qwen-vl'], data);
  assert.match(report, /80\.0%/);
  assert.match(report, /单次耗时：未记录/);
  assert.match(report, /单次成本：0 元/);
  assert.doesNotMatch(report, /Neural CAD/);
  assert.throws(() => generateReport('研究周报', '空', [], data));
});
test('预览、导出和来源链接不会执行输入的 HTML 或脚本', () => {
  const malicious = '<img src=x onerror=alert(1)><script>alert(1)</script>';
  assert.doesNotMatch(renderMarkdown(malicious), /<img|<script>/);
  assert.doesNotMatch(reportHtml('</title><script>alert(1)</script>', malicious), /<script>/);
  assert.equal(safeUrl('javascript:alert(1)'), '');
  assert.equal(safeUrl('data:text/html,test'), '');
  assert.equal(safeUrl('https://example.com'), 'https://example.com/');
  assert.match(escapeHtml('"<test>'), /&quot;&lt;test&gt;/);
});
test('报告按记录日期筛选实验与研究手记，拒绝反向日期范围', () => {
  const data = structuredClone(initialWorkspace);
  data.experiments.push({ ...data.experiments[0], id: 'real', demo: false, date: '2026-11-01' });
  data.notes.push({
    ...data.notes[0],
    id: 'real-note',
    demo: false,
    title: '真实手记测试',
    date: '2026-11-20',
  });
  const report = generateReport(
    '研究周报',
    '周报',
    data.models.map((m) => m.id),
    data,
    { start: '2026-11-18', end: '2026-11-24' },
  );
  assert.match(report, /暂无用户录入的实验数据/);
  assert.match(report, /真实手记测试/);
  assert.match(report, /2026-11-18 至 2026-11-24/);
  assert.throws(() =>
    generateReport('研究周报', '周报', ['qwen-vl'], data, {
      start: '2026-11-24',
      end: '2026-11-18',
    }),
  );
});
