-- 接入信息独立保存，不进入研究空间 JSON 备份；密钥只保存服务端密文。
CREATE TABLE model_connections (
    workspace_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    config JSONB NOT NULL,
    api_key_ciphertext TEXT,
    revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, model_id),
    FOREIGN KEY (workspace_id, model_id) REFERENCES models(workspace_id, id) ON DELETE CASCADE
);
CREATE TABLE chat_sessions (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id),
    title TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX chat_sessions_recent ON chat_sessions(workspace_id, updated_at DESC);
ALTER TABLE runtime_runs ADD COLUMN conversation_id TEXT REFERENCES chat_sessions(id);
-- 历史模型编号和快照保留，即使档案之后被删除，也能阅读原对话。
ALTER TABLE runtime_runs ADD COLUMN model_id TEXT;
ALTER TABLE runtime_runs ADD COLUMN model_snapshot JSONB;
CREATE INDEX runtime_runs_conversation ON runtime_runs(conversation_id, started_at, id);
CREATE UNIQUE INDEX runtime_runs_one_active_turn ON runtime_runs(conversation_id)
    WHERE conversation_id IS NOT NULL AND status IN ('pending', 'running');
CREATE TABLE experiment_run_links (
    workspace_id TEXT NOT NULL DEFAULT 'default',
    experiment_id TEXT NOT NULL,
    run_id TEXT NOT NULL UNIQUE REFERENCES runtime_runs(id),
    PRIMARY KEY (workspace_id, experiment_id),
    FOREIGN KEY (workspace_id, experiment_id) REFERENCES experiments(workspace_id, id) ON DELETE CASCADE
);
