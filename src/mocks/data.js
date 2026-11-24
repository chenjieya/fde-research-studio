/** @type {import('../types').Workspace} */
export const initialWorkspace = {
  version: 1,
  models: [
    { id: 'qwen-vl', name: 'Qwen2.5-VL', vendor: 'Alibaba · Qwen', domain: '图片', capabilities: ['识别理解'], stage: '研究中', summary: '从文档、图表到视觉定位，探索结构化信息提取的边界。', route: '视觉语言模型（VLM）', access: '开放权重 / 云 API，具体规格待核实', license: '依具体版本核实', source: 'https://qwenlm.github.io/blog/qwen2.5-vl/', updated: '2026-11-24', notes: '待验证：密集小字、旋转图纸、跨页表格，以及结构化输出的稳定性。', demo: true, favorite: true },
    { id: 'neural-cad', name: 'Neural CAD', vendor: 'Autodesk Research', domain: 'CAD', capabilities: ['生成编辑', '识别理解'], stage: '持续跟踪', summary: '让设计意图与空间约束，成为可编辑的精确几何。', route: 'CAD 几何基础模型', access: '研究与产品动态，开放情况待核实', license: '待核实', source: 'https://www.research.autodesk.com/blog/neural-cad-how-ai-can-reason-in-design-and-engineering/', updated: '2026-11-24', notes: '关注原生几何输出、约束保持、参数可编辑性。研究展示与可调用产品分别记录。', demo: true, favorite: true },
    { id: 'cosmos', name: 'Cosmos', vendor: 'NVIDIA', domain: '视频', capabilities: ['生成编辑', '识别理解'], stage: '待调研', summary: '从视觉推理到世界生成，研究物理 AI 的能力与限制。', route: '世界基础模型', access: '模型平台 / 开放权重，依版本核实', license: '依具体版本核实', source: 'https://docs.nvidia.com/cosmos/index.html', updated: '2026-11-24', notes: '先确定版本与任务：视频生成、物理推理、合成数据。重点验证物理一致性。', demo: true, favorite: false },
    { id: 'qwen-image', name: 'Qwen-Image-Edit', vendor: 'Alibaba · Qwen', domain: '图片', capabilities: ['生成编辑'], stage: '研究中', summary: '用自然语言修改图像，考察局部可控性与主体一致性。', route: '图像生成与指令编辑', access: '开放权重，版本与部署条件待核实', license: '依具体版本核实', source: 'https://github.com/QwenLM/Qwen-Image', updated: '2026-11-23', notes: '评估修改区域外的保持程度，以及中文文字编辑。', demo: true, favorite: false },
    { id: 'text-cad', name: 'Text-to-CadQuery', vendor: 'Research paper', domain: 'CAD', capabilities: ['生成编辑'], stage: '待调研', summary: '通过建模代码，把自然语言需求转换为参数化三维模型。', route: '语言模型 + CadQuery 代码生成', access: '论文 / 开源项目，待复现', license: '待核实', source: 'https://arxiv.org/abs/2505.06507', updated: '2026-11-23', notes: '关注代码可执行率、几何有效性与尺寸满足率，分别记录。', demo: true, favorite: false },
    { id: 'sam3d', name: 'SAM 3D', vendor: 'Meta', domain: '图片', capabilities: ['生成编辑', '识别理解'], stage: '持续跟踪', summary: '从一张图片恢复三维形状、纹理与物体布局。', route: '视觉驱动的三维重建', access: '研究 / 开放项目，依具体模型核实', license: '待核实', source: 'https://ai.meta.com/blog/sam-3d', updated: '2026-11-22', notes: '视觉重建与工程 CAD 分开评估；不能从渲染效果推断尺寸精度。', demo: true, favorite: false }
  ],
  experiments: [
    { id: 'exp-demo-1', title: '密集图表的结构化提取', modelId: 'qwen-vl', task: '识别理解', dataset: '演示样本集 A（虚构）', sampleSize: 20, successCount: 16, latency: 3.2, cost: null, conclusion: '演示结论：规则表格提取较完整，小字与合并单元格需要人工复核。', limitations: '所有数字为界面演示，不代表真实模型效果，不能用于选型。', date: '2026-11-24', demo: true },
    { id: 'exp-demo-2', title: '产品图的局部指令编辑', modelId: 'qwen-image', task: '生成编辑', dataset: '演示样本集 B（虚构）', sampleSize: 12, successCount: 9, latency: 18, cost: null, conclusion: '演示结论：单一修改容易检查，多步骤修改需单独制定验收规则。', limitations: '虚构实验，仅演示记录流程。尚未进行真实推理。', date: '2026-11-23', demo: true }
  ],
  notes: [
    { id: 'note-1', title: '从“生成形状”到“生成设计意图”', domain: 'CAD', stage: '研究中', body: '调研 CAD 原生几何、约束和参数的表达方式。对比建模代码生成与专用几何模型，整理各自的验证路径。', source: 'https://www.research.autodesk.com/blog/neural-cad-how-ai-can-reason-in-design-and-engineering/', date: '2026-11-24', demo: true },
    { id: 'note-2', title: '世界模型如何验证物理一致性？', domain: '视频', stage: '待调研', body: '建立可复现的场景：遮挡、碰撞、物体永久性与相机运动。记录失败样例，避免只凭观看体验评价。', source: 'https://docs.nvidia.com/cosmos/index.html', date: '2026-11-24', demo: true },
    { id: 'note-3', title: '局部编辑，如何衡量“其他部分不变”', domain: '图片', stage: '持续跟踪', body: '分别评价指令遵循、主体身份、文字准确性与修改区域外的变化。准备可人工复核的测试标准。', source: 'https://github.com/QwenLM/Qwen-Image', date: '2026-11-23', demo: true }
  ],
  artifacts: []
};
