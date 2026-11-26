import test from 'node:test';
import assert from 'node:assert/strict';
import { createRun, uploadMedia, getRun } from '../src/lib/runtime-api.js';
import { mediaView } from '../src/components/media-view.js';

const id = '00000000-0000-0000-0000-000000000001';
const media = {
  id,
  kind: 'image',
  mime_type: 'image/png',
  filename: '<sample>.png',
  size: 20,
  url: `/api/runtime/media/${id}`,
};
const run = {
  id,
  graph_id: 'prism_research',
  input: '研究',
  input_media: [media],
  status: 'success',
  started_at: '2026-11-25',
  output: { media: [media] },
  trace_status: 'unverified',
};
const response = (body) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

test('创建运行发送媒体引用与任务类型，附件不塞进提示词', async (t) => {
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.deepEqual(body.attachment_ids, [id]);
    assert.equal(body.generation_mode, 'image2video');
    assert.equal(body.prompt, '研究');
    return response(run);
  });
  assert.deepEqual(
    await createRun('研究', 'model-a', 'conversation', undefined, [id], 'image2video'),
    run,
  );
});

test('附件上传使用原始文件与正确的媒体类型', async (t) => {
  const file = new File(['sample'], 'sample.png', { type: 'image/png' });
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /media\?filename=sample.png$/);
    assert.equal(options.body, file);
    assert.equal(options.headers['Content-Type'], 'image/png');
    return response(media);
  });
  assert.deepEqual(await uploadMedia(file), media);
});

test('媒体展示转义名称，只接受当前服务的媒体地址', () => {
  const html = mediaView([media]);
  assert.match(html, /&lt;sample&gt;/);
  assert.equal(mediaView([{ ...media, url: 'javascript:alert(1)' }]), '');
  assert.equal(mediaView([{ ...media, url: 'https://external.example/media' }]), '');
  assert.match(mediaView([{ ...media, kind: 'video' }]), /<video[^>]*controls/);
});

test('异常媒体引用不能通过运行结果格式校验', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    response({ ...run, output: { media: [{ ...media, url: 'https://external.example/media' }] } }),
  );
  await assert.rejects(getRun(id), /格式不匹配/);
});
