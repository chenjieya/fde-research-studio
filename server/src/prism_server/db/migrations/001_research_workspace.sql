CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0 CHECK (revision >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO workspaces(id, name) VALUES ('default', 'FDE 研究空间');

CREATE TABLE models (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    id TEXT NOT NULL,
    name TEXT NOT NULL CHECK (length(name) > 0),
    vendor TEXT NOT NULL,
    domain TEXT NOT NULL CHECK (domain IN ('图片', 'CAD', '视频')),
    stage TEXT NOT NULL CHECK (stage IN ('待调研', '研究中', '已验证', '持续跟踪')),
    summary TEXT NOT NULL,
    route TEXT NOT NULL,
    access TEXT NOT NULL,
    license TEXT NOT NULL,
    source TEXT NOT NULL,
    updated DATE NOT NULL,
    notes TEXT NOT NULL,
    demo BOOLEAN NOT NULL,
    favorite BOOLEAN NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, id)
);
CREATE INDEX models_domain_stage ON models(workspace_id, domain, stage);
CREATE TABLE model_capabilities (
    workspace_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    capability TEXT NOT NULL CHECK (capability IN ('生成编辑', '识别理解')),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (workspace_id, model_id, capability),
    FOREIGN KEY (workspace_id, model_id) REFERENCES models(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE experiments (
    workspace_id TEXT NOT NULL,
    id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(title) > 0),
    task TEXT NOT NULL,
    dataset TEXT NOT NULL,
    sample_size INTEGER NOT NULL CHECK (sample_size > 0),
    success_count INTEGER NOT NULL CHECK (success_count BETWEEN 0 AND sample_size),
    latency DOUBLE PRECISION CHECK (latency >= 0 AND latency < 'Infinity'::float8),
    cost DOUBLE PRECISION CHECK (cost >= 0 AND cost < 'Infinity'::float8),
    conclusion TEXT NOT NULL,
    limitations TEXT NOT NULL,
    date DATE NOT NULL,
    demo BOOLEAN NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, id),
    FOREIGN KEY (workspace_id, model_id) REFERENCES models(workspace_id, id)
);
CREATE INDEX experiments_model_date ON experiments(workspace_id, model_id, date DESC);

CREATE TABLE research_notes (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    id TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(title) > 0),
    domain TEXT NOT NULL CHECK (domain IN ('图片', 'CAD', '视频')),
    stage TEXT NOT NULL CHECK (stage IN ('待调研', '研究中', '已验证', '持续跟踪')),
    body TEXT NOT NULL,
    source TEXT NOT NULL,
    date DATE NOT NULL,
    demo BOOLEAN NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, id)
);
CREATE INDEX research_notes_stage ON research_notes(workspace_id, stage);
CREATE TABLE artifacts (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    id TEXT NOT NULL,
    title TEXT NOT NULL CHECK (length(title) > 0),
    kind TEXT NOT NULL CHECK (kind IN ('研究周报', '模型对比报告', 'FDE 方案草稿', '技术调研简报')),
    content TEXT NOT NULL,
    date DATE NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, id)
);
CREATE TABLE artifact_models (
    workspace_id TEXT NOT NULL,
    artifact_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY (workspace_id, artifact_id, model_id),
    FOREIGN KEY (workspace_id, artifact_id) REFERENCES artifacts(workspace_id, id) ON DELETE CASCADE,
    FOREIGN KEY (workspace_id, model_id) REFERENCES models(workspace_id, id)
);
CREATE INDEX artifact_models_model ON artifact_models(workspace_id, model_id);

CREATE TABLE workspace_imports (
    workspace_id TEXT NOT NULL REFERENCES workspaces(id),
    source_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    counts JSONB NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, source_id)
);
CREATE TABLE runtime_runs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id),
    graph_id TEXT NOT NULL,
    input TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'error', 'timeout', 'interrupted')),
    thread_id TEXT,
    agent_run_id TEXT,
    output JSONB,
    error TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    trace_status TEXT NOT NULL DEFAULT 'unverified' CHECK (trace_status IN ('unverified', 'verified')),
    trace_url TEXT
);
CREATE INDEX runtime_runs_recent ON runtime_runs(workspace_id, started_at DESC, id DESC);
