import { isWorkspace } from './workspace.js';

const LEGACY_KEY = 'prism-research-workspace-v1';

export class WorkspaceApiError extends Error {
  // 保留 HTTP 状态，页面遇到 409 时可以提示版本冲突并重新读取记录。
  /** @param {string} message @param {number} status */
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

/**
 * 检查服务端是否返回完整记录和有效版本号。
 * @param {unknown} value
 * @returns {value is import('../types').WorkspaceSnapshot}
 */
function isSnapshot(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    'data' in value &&
    'revision' in value &&
    typeof value.revision === 'number' &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    isWorkspace(value.data)
  );
}

/**
 * 统一处理研究空间请求、超时、错误提示和返回格式检查。
 * @param {string} [path]
 * @param {RequestInit} [options]
 * @returns {Promise<import('../types').WorkspaceSnapshot>}
 */
async function request(path = '', options = {}) {
  try {
    const response = await fetch(`/api/workspace${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(35000),
    });
    if (!response.headers.get('content-type')?.includes('application/json')) {
      throw new WorkspaceApiError(
        '无法连接研究空间，请检查 Agent Server 和数据库服务。',
        response.status,
      );
    }
    const body = /** @type {unknown} */ (await response.json());
    if (!response.ok) {
      const detail =
        typeof body === 'object' && body !== null && 'detail' in body ? body.detail : undefined;
      throw new WorkspaceApiError(
        typeof detail === 'string' ? detail : '研究记录保存失败，请检查数据后重试。',
        response.status,
      );
    }
    if (!isSnapshot(body)) throw new Error('研究空间数据格式不匹配。');
    return body;
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === 'TimeoutError')
    ) {
      throw new Error('研究空间连接失败或超时，请检查服务、数据库及 SSH 隧道后重试。', {
        cause: error,
      });
    }
    throw error;
  }
}

/**
 * 读取线上研究记录及当前版本号。
 * @returns {Promise<import('../types').WorkspaceSnapshot>}
 */
export function getWorkspace() {
  return request();
}

/** 读取旧浏览器记录，仅用于迁移和原始备份。 */
export function getLegacyBackup() {
  return localStorage.getItem(LEGACY_KEY) ?? '';
}

/** 先读取云端，再迁移旧浏览器记录；服务端确认成功后才清理旧记录。 */
export async function readWorkspace() {
  const snapshot = await getWorkspace();
  const raw = getLegacyBackup();
  if (!raw) return snapshot;
  let legacy;
  try {
    legacy = /** @type {unknown} */ (JSON.parse(raw));
  } catch (cause) {
    throw new Error('旧浏览器记录无法解析，请先导出原始记录核对。', { cause });
  }
  if (!isWorkspace(legacy)) throw new Error('旧浏览器记录格式不完整，原数据已保留，请先导出核对。');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  // 同一份旧记录得到同一个迁移编号，网络中断后重试不会重复写入。
  const sourceId =
    'browser:' +
    [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
  const migrated = await request('/import', {
    method: 'POST',
    body: JSON.stringify({ data: legacy, source_id: sourceId }),
  });
  // 用户在另一标签页修改旧存储时，不删除尚未迁移的新内容。
  if (localStorage.getItem(LEGACY_KEY) !== raw)
    throw new Error('迁移期间旧记录发生变化，请重新加载完成剩余迁移。');
  localStorage.removeItem(LEGACY_KEY);
  return migrated;
}

/**
 * 保存整份记录并带上读取时的版本号，避免覆盖其他页面的修改。
 * @param {import('../types').Workspace} data
 * @param {number} revision
 */
export function persistWorkspace(data, revision) {
  if (!isWorkspace(data)) throw new Error('数据校验失败，请检查记录内容。');
  return request('', {
    method: 'PUT',
    body: JSON.stringify({ data, expected_revision: revision }),
  });
}
