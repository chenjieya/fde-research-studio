// 前端数据类型：研究记录沿用 JSON 备份字段，运行记录对应后端 API。
export type Domain = '图片' | 'CAD' | '视频' | '语言文本';
export type Stage = '待调研' | '研究中' | '已验证' | '持续跟踪';
export type Page = 'overview' | 'models' | 'experiments' | 'frontier' | 'deliverables';
export type ReportKind = '研究周报' | '模型对比报告' | 'FDE 方案草稿' | '技术调研简报';
export interface ModelRecord {
  /** 档案编号，实验和交付物通过它关联模型。 */
  id: string;
  name: string;
  vendor: string;
  domain: Domain;
  capabilities: string[];
  stage: Stage;
  summary: string;
  route: string;
  access: string;
  license: string;
  source: string;
  updated: string;
  notes: string;
  /** 示例资料标记；保存到真实数据库后也保留，避免误当已核实资料。 */
  demo: boolean;
  favorite: boolean;
}
export interface Experiment {
  /** 一次实验的独立编号，同一个模型可以有多条实验。 */
  id: string;
  title: string;
  modelId: string;
  task: string;
  dataset: string;
  sampleSize: number;
  successCount: number;
  /** 单次耗时，单位秒；null 表示未记录，零表示记录值确实为零。 */
  latency: number | null;
  /** 单次成本，单位元；null 表示未记录。 */
  cost: number | null;
  conclusion: string;
  limitations: string;
  date: string;
  demo: boolean;
}
export interface ResearchNote {
  /** 研究手记的编号，与模型档案分别管理。 */
  id: string;
  title: string;
  domain: Domain;
  stage: Stage;
  body: string;
  source: string;
  date: string;
  demo: boolean;
}
export interface Artifact {
  /** 交付物编号；正文保存为 Markdown。 */
  id: string;
  title: string;
  kind: ReportKind;
  modelIds: string[];
  content: string;
  date: string;
}
export interface Workspace {
  /** JSON 备份格式的版本，不是数据库迁移版本。 */
  version: 1;
  models: ModelRecord[];
  experiments: Experiment[];
  notes: ResearchNote[];
  artifacts: Artifact[];
}
export interface WorkspaceSnapshot {
  data: Workspace;
  /** 保存时带回这个版本号，后端用它判断记录是否已被其他页面修改。 */
  revision: number;
}
export interface RuntimeHealth {
  /** 服务公开的配置状态，不包含 API key 或数据库密码。 */
  service: string;
  stage: string;
  graph_id: string;
  execution_mode: string;
  agent_public_url: string;
  studio_url: string;
  storage: string;
  tracing: { enabled: boolean; key_configured: boolean; project: string; verified: boolean };
}
export interface RuntimeGraph {
  /** Agent Server 中注册的图名，对应 langgraph.json 的 graphs。 */
  graph_id: string;
  compiled: true;
  graph: {
    nodes: { id: string | number; data?: unknown }[];
    edges: { source: string; target: string }[];
  };
}
export interface RuntimeRun {
  /** 工作台保存的运行编号，与 Agent Server 的 agent_run_id 分开。 */
  id: string;
  graph_id: string;
  input: string;
  status: 'pending' | 'running' | 'success' | 'error' | 'timeout' | 'interrupted';
  thread_id: string | null;
  agent_run_id: string | null;
  output: Record<string, unknown> | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
  /** 后端实际查到 LangSmith 记录后才会变为 verified。 */
  trace_status: 'unverified' | 'verified';
  trace_url: string | null;
  conversation_id: string | null;
  model_id: string | null;
  model_snapshot: {
    name?: string;
    provider?: string;
    api_model?: string;
    system_prompt?: string;
  } | null;
}
/** 接入配置独立存储，研究备份不携带凭据。 */
export interface ModelConnection {
  model_id: string;
  name: string;
  provider: 'openai' | 'anthropic';
  api_model: string;
  base_url: string;
  enabled: boolean;
  system_prompt: string;
  temperature: number | null;
  max_tokens: number;
  timeout_seconds: number;
  revision: number;
  api_key_configured: boolean;
}
export type ModelConnectionInput = Omit<
  ModelConnection,
  'model_id' | 'name' | 'revision' | 'api_key_configured'
> & {
  api_key: string;
  clear_api_key: boolean;
  expected_revision: number;
};
export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}
