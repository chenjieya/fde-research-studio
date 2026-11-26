-- 原始媒体不进入图检查点；数据库备份同时保留附件与生成结果。
CREATE TABLE media_assets (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL DEFAULT 'default' REFERENCES workspaces(id),
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video')),
    mime_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    size INTEGER NOT NULL CHECK (size > 0 AND size <= 67108864),
    content BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (octet_length(content) = size)
);
ALTER TABLE runtime_runs ADD COLUMN input_media JSONB NOT NULL DEFAULT '[]'::jsonb;
