-- 在轮询前持久化厂商任务号；同一图请求重新执行时继续查询，避免重复创建计费任务。
CREATE TABLE generation_jobs (
    request_id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    model_revision INTEGER NOT NULL,
    remote_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
