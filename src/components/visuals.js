import { escapeHtml } from '../lib/workspace.js';
const paths = {
  overview:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  models: '<path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  experiments:
    '<path d="M9 3h6m-5 0v7l-6 9a1 1 0 0 0 1 2h14a1 1 0 0 0 1-2l-6-9V3M8 15h8"/><path d="m10 18 1-1m3 2 1-1"/>',
  frontier: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/>',
  deliverables:
    '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Zm0 0v6h6M8 13h8m-8 4h5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  external:
    '<path d="M14 3h7v7m-1-6-9 9M10 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-5"/>',
  star: '<path d="m12 3 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3L3 9.6l6.2-.9L12 3Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 17v4h16v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 11-2l3 3M4 16l3 3a7 7 0 0 0 11-2"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  cad: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5Zm0 10 9-5M12 12 3 7m9 5v10"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9 5 3-5 3V9Z"/>',
  text: '<path d="M5 4h14v12H9l-4 4V4ZM8 8h8M8 12h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  edit: '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  spark: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/>',
  book: '<path d="M12 5C8 2 4 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Zm0 0v15"/>',
  print: '<path d="M7 8V3h10v5M7 17H3V8h18v9h-4M7 13h10v8H7v-8Z"/>',
};
/**
 * 从本地图标表生成 SVG，不依赖外部图片请求。
 * @param {string} name
 * @param {string} [className]
 */
export function icon(name, className = '') {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[/** @type {keyof typeof paths} */ (name)] || paths.book}</svg>`;
}
let count = 0;
/**
 * 用本地 SVG 绘制各研究领域的配图。
 * @param {string} domain
 * @param {boolean} [hero]
 */
export function artwork(domain, hero = false) {
  const id = `study-${++count}`;
  if (domain === '语言文本')
    return `<svg viewBox="0 0 480 260" class="study text-study" aria-hidden="true"><defs><linearGradient id="${id}" x2="1" y2="1"><stop stop-color="#fffdf7"/><stop offset="1" stop-color="#eee2cd"/></linearGradient></defs><path d="M66 64h348M66 110h348M66 156h348M66 202h348" stroke="#cbbb9f" stroke-opacity=".2"/><rect x="133" y="30" width="218" height="194" rx="12" fill="#d4c1a4" opacity=".35" transform="rotate(8 242 127)"/><rect x="119" y="25" width="218" height="194" rx="12" fill="url(#${id})" stroke="#cbb99b" transform="rotate(-5 228 122)"/><g transform="rotate(-5 228 122)"><text x="147" y="90" fill="#8b7353" font-family="Georgia,serif" font-size="44">Aa</text><path d="M148 115h159M148 130h130M148 145h150M148 160h105" stroke="#b7a586" stroke-width="3" stroke-linecap="round"/><rect x="148" y="180" width="63" height="17" rx="8" fill="#ded2bb"/><circle cx="224" cy="188" r="3" fill="#b49a73"/><circle cx="236" cy="188" r="3" fill="#b49a73"/><circle cx="248" cy="188" r="3" fill="#b49a73"/></g><path d="M309 132h72a10 10 0 0 1 10 10v40a10 10 0 0 1-10 10h-24l-17 15v-15h-31a10 10 0 0 1-10-10v-40a10 10 0 0 1 10-10Z" fill="#8d9b8c" stroke="#7c8d7d"/><path d="M315 153h59M315 168h40" stroke="#f1f1df" stroke-width="3" stroke-linecap="round"/><path d="m94 64 5 12 12 5-12 5-5 12-5-12-12-5 12-5Z" fill="#b4a07e"/></svg>`;
  if (domain === 'CAD') {
    const rings = Array.from(
      { length: 14 },
      (_, i) =>
        `<ellipse cx="238" cy="${90 + i * 6}" rx="${93 - i * 1.1}" ry="${41 - i * 0.4}" fill="${i === 13 ? '#dae1f5' : 'none'}" stroke="${hero ? '#a3b6ff' : '#6e81b3'}" stroke-opacity="${0.4 + i * 0.035}" stroke-width=".85"/>`,
    ).join('');
    return `<svg viewBox="0 0 480 260" class="study cad-study" aria-hidden="true"><defs><pattern id="${id}" width="30" height="30" patternUnits="userSpaceOnUse" patternTransform="skewY(-17)"><path d="M30 0H0v30" fill="none" stroke="${hero ? '#738cc6' : '#b5bfd7'}" stroke-opacity=".2"/></pattern></defs><rect width="480" height="260" fill="url(#${id})"/><g transform="rotate(-15 240 130)"><path d="m103 167 138-72 133 75-136 74Z" fill="${hero ? '#334c7c' : '#e1e7f3'}" stroke="${hero ? '#9cb2e9' : '#8b9bbd'}"/><path d="m103 167 1 16 134 77 136-73v-17M238 244v16" fill="none" stroke="${hero ? '#9cb2e9' : '#8b9bbd'}"/>${rings}<ellipse cx="238" cy="90" rx="93" ry="41" fill="${hero ? '#6986c8' : '#d0daef'}" stroke="${hero ? '#c4d2ff' : '#6e81b3'}"/><ellipse cx="238" cy="90" rx="44" ry="19" fill="${hero ? '#1c315a' : '#f1f4fb'}" stroke="${hero ? '#c4d2ff' : '#6e81b3'}"/><path d="M238 8v49m-10-10 10 10 10-10M76 91h61m-10-10 10 10-10 10" fill="none" stroke="${hero ? '#efab86' : '#b96841'}" stroke-width="1.4" stroke-dasharray="4 4"/><path d="m330 76 39-19m-45 62 57-32m-13-31 14 31M365 55l8 4m4 24 8 5" stroke="${hero ? '#b6c4ed' : '#8b9bbd'}" fill="none"/></g><g fill="${hero ? '#b4c4ee' : '#7789ae'}" font-family="sans-serif" font-size="10"><text x="366" y="57">Ø 48</text><text x="62" y="223">x</text><text x="106" y="247">y</text><text x="78" y="203">z</text></g><path d="m79 232 21 12m-21-12-18 7m18-7v-23" stroke="${hero ? '#8ca4d8' : '#94a4c3'}"/></svg>`;
  }
  if (domain === '视频')
    return `<svg viewBox="0 0 480 260" class="study video-study" aria-hidden="true"><defs><linearGradient id="${id}" x2="1" y2="1"><stop stop-color="#e4a48c"/><stop offset=".5" stop-color="#e9c6ac"/><stop offset="1" stop-color="#90b9b1"/></linearGradient><clipPath id="${id}-clip"><rect x="110" y="26" width="260" height="180" rx="9"/></clipPath></defs><path d="M0 217h480M0 228h480M0 239h480" stroke="#b9cfca" stroke-opacity=".5"/><rect x="70" y="53" width="260" height="180" rx="9" fill="#c4d9d5" stroke="#a8c4bf"/><rect x="90" y="40" width="260" height="180" rx="9" fill="#dde8df" stroke="#a8c4bf"/><rect x="110" y="26" width="260" height="180" rx="9" fill="url(#${id})"/><g clip-path="url(#${id}-clip)"><circle cx="292" cy="80" r="40" fill="#ffe5c5"/><path d="m99 187 83-89 88 105 56-70 63 67v32H90Z" fill="#638f8e"/><path d="m83 224 111-88 56 64 57-33 87 68" fill="#365f68"/><path d="m170 205 31-53 20 27-18 26Z" fill="#b5ccc0" opacity=".9"/></g><circle cx="241" cy="113" r="23" fill="#fff" fill-opacity=".8"/><path d="m236 103 15 10-15 10Z" fill="#3a5c63"/><g fill="#597975">${Array.from({ length: 28 }, (_, i) => `<rect x="${62 + i * 13}" y="${244 - Math.sin(i * 0.7) * 5}" width="3" height="${Math.max(3, 8 + Math.sin(i * 0.7) * 10)}" rx="1.5"/>`).join('')}</g></svg>`;
  return `<svg viewBox="0 0 480 260" class="study image-study" aria-hidden="true"><defs><radialGradient id="${id}" cx=".3" cy=".2" r=".9"><stop stop-color="#f5ecff"/><stop offset=".32" stop-color="#b9a6ee"/><stop offset=".65" stop-color="#7262b9"/><stop offset="1" stop-color="#45406f"/></radialGradient><radialGradient id="${id}-b" cx=".3" cy=".2"><stop stop-color="#ffe3d2"/><stop offset=".6" stop-color="#d9a6a3"/><stop offset="1" stop-color="#a07799"/></radialGradient></defs><path d="M54 210h370M54 180h370M54 150h370M54 120h370M54 90h370M84 55v165M144 55v165M204 55v165M264 55v165M324 55v165M384 55v165" stroke="#afa2c7" stroke-opacity=".2"/><ellipse cx="248" cy="217" rx="130" ry="18" fill="#a495b7" opacity=".2"/><path d="M156 194c-51-36-34-86 10-104 14-59 89-77 125-26 66 10 90 69 47 112-18 49-77 56-113 30-30 13-51 7-69-12Z" fill="url(#${id})"/><ellipse cx="213" cy="119" rx="51" ry="58" fill="url(#${id}-b)" transform="rotate(28 213 119)"/><ellipse cx="265" cy="165" rx="46" ry="42" fill="url(#${id})"/><path d="M127 75V54h22m192 0h21v21M127 183v22h22m192 0h21v-22" fill="none" stroke="#6f5a99" stroke-width="1.1"/><circle cx="360" cy="55" r="3" fill="#e18d73"/></svg>`;
}
/**
 * 生成模型卡片，用户填写的文字先转义再插入页面。
 * @param {import('../types').ModelRecord} model
 */
export function modelCard(model) {
  return `<article class="model-card"><button class="model-art ${model.domain === '图片' ? 'art-image' : model.domain === 'CAD' ? 'art-cad' : model.domain === '视频' ? 'art-video' : 'art-text'}" data-action="detail" data-id="${escapeHtml(model.id)}" aria-label="查看 ${escapeHtml(model.name)}">${artwork(model.domain)}<span class="art-domain">${icon(model.domain === '图片' ? 'image' : model.domain === 'CAD' ? 'cad' : model.domain === '视频' ? 'video' : 'text')}${model.domain}</span></button><div class="model-body"><div class="model-title-row"><button class="title-button" data-action="detail" data-id="${escapeHtml(model.id)}">${escapeHtml(model.name)}</button><button class="icon-button favorite ${model.favorite ? 'is-favorite' : ''}" data-action="favorite" data-id="${escapeHtml(model.id)}" aria-label="${model.favorite ? '取消关注' : '关注'} ${escapeHtml(model.name)}" aria-pressed="${model.favorite}">${icon('star')}</button></div><p class="model-vendor">${escapeHtml(model.vendor)}</p><p class="model-summary">${escapeHtml(model.summary)}</p><div class="model-bottom"><span class="cap-label">${model.capabilities.map(escapeHtml).join(' / ')}</span><span class="stage stage-${model.stage}">${model.stage}</span></div></div></article>`;
}
