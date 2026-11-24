export type Domain = '图片' | 'CAD' | '视频';
export type Stage = '待调研' | '研究中' | '已验证' | '持续跟踪';
export type Page = 'overview' | 'models' | 'experiments' | 'frontier' | 'deliverables';
export type ReportKind = '研究周报' | '模型对比报告' | 'FDE 方案草稿' | '技术调研简报';
export interface ModelRecord {
  id: string; name: string; vendor: string; domain: Domain; capabilities: string[];
  stage: Stage; summary: string; route: string; access: string; license: string;
  source: string; updated: string; notes: string; demo: boolean; favorite: boolean;
}
export interface Experiment {
  id: string; title: string; modelId: string; task: string; dataset: string;
  sampleSize: number; successCount: number; latency: number | null; cost: number | null;
  conclusion: string; limitations: string; date: string; demo: boolean;
}
export interface ResearchNote {
  id: string; title: string; domain: Domain; stage: Stage; body: string; source: string; date: string; demo: boolean;
}
export interface Artifact {
  id: string; title: string; kind: ReportKind; modelIds: string[]; content: string; date: string;
}
export interface Workspace {
  version: 1; models: ModelRecord[]; experiments: Experiment[]; notes: ResearchNote[]; artifacts: Artifact[];
}
