import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkspace } from '../src/lib/workspace.js';
import { readWorkspace, persistWorkspace, WorkspaceApiError } from '../src/lib/workspace-api.js';

const key = 'prism-research-workspace-v1';
const snapshot = { data: emptyWorkspace(), revision: 1 };
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function storage(t, raw) {
  const values = new Map(raw === undefined ? [] : [[key, raw]]);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (name) => values.get(name) ?? null,
      removeItem: (name) => values.delete(name),
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  return values;
}

test('旧浏览器记录只有在数据库确认写入后才被清理', async (t) => {
  const raw = JSON.stringify(snapshot.data);
  const values = storage(t, raw);
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push(url);
    if (options.method === 'POST') {
      assert.equal(values.get(key), raw);
      const payload = JSON.parse(options.body);
      assert.match(payload.source_id, /^browser:[0-9a-f]{64}$/);
      assert.deepEqual(payload.data, snapshot.data);
    }
    return json(snapshot);
  });
  assert.deepEqual(await readWorkspace(), snapshot);
  assert.equal(values.has(key), false);
  assert.deepEqual(calls, ['/api/workspace', '/api/workspace/import']);
});

for (const status of [409, 503]) {
  test(`迁移返回 ${status} 时保留完整旧浏览器记录`, async (t) => {
    const raw = JSON.stringify(snapshot.data);
    const values = storage(t, raw);
    t.mock.method(globalThis, 'fetch', async (_, options) =>
      options.method === 'POST' ? json({ detail: '迁移失败' }, status) : json(snapshot),
    );
    await assert.rejects(readWorkspace(), WorkspaceApiError);
    assert.equal(values.get(key), raw);
  });
}

test('迁移过程中另一标签页改变旧记录时，不清理新的内容', async (t) => {
  const values = storage(t, JSON.stringify(snapshot.data));
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    if (options.method === 'POST') values.set(key, 'another-tab-update');
    return json(snapshot);
  });
  await assert.rejects(readWorkspace(), /迁移期间旧记录发生变化/);
  assert.equal(values.get(key), 'another-tab-update');
});

test('旧记录损坏时停止迁移，并保留原文供备份', async (t) => {
  const values = storage(t, 'invalid-json');
  const fetch = t.mock.method(globalThis, 'fetch', async () => json(snapshot));
  await assert.rejects(readWorkspace(), /无法解析/);
  assert.equal(values.get(key), 'invalid-json');
  assert.equal(fetch.mock.callCount(), 1);
});

test('没有旧数据时只读取云端；保存携带版本号且不写入浏览器存储', async (t) => {
  storage(t);
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    requests.push(options);
    return json(snapshot);
  });
  await readWorkspace();
  await persistWorkspace(snapshot.data, 7);
  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[1].body), { data: snapshot.data, expected_revision: 7 });
});
