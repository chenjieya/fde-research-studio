import { escapeHtml as esc } from '../lib/workspace.js';

/** 只展示服务端媒体引用，拒绝来自记录的脚本地址和任意外部资源。 @param {import('../types').MediaAsset[]} [assets] */
export function mediaView(assets = []) {
  return assets
    .filter(
      (asset) => asset.url === `/api/runtime/media/${asset.id}` && /^[0-9a-f-]{36}$/.test(asset.id),
    )
    .map(
      (asset) =>
        `<figure class="chat-media">${asset.kind === 'image' ? `<a href="${esc(asset.url)}" target="_blank" rel="noopener noreferrer"><img src="${esc(asset.url)}" alt="${esc(asset.filename)}" loading="lazy"></a>` : `<video src="${esc(asset.url)}" controls preload="metadata" aria-label="${esc(asset.filename)}"></video>`}<figcaption><span title="${esc(asset.filename)}">${esc(asset.filename)}</span><a href="${esc(asset.url)}" download="${esc(asset.filename)}">下载 · ${(asset.size / 1024 / 1024).toFixed(2)} MB</a></figcaption></figure>`,
    )
    .join('');
}
