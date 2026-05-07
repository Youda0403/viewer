/**
 * Roll20 CSS 매크로 테스터
 *
 * Roll20 채팅창에 매크로를 보내지 않고 미리 결과를 확인할 수 있는 정적 사이트.
 * Roll20의 화이트리스트 기반 sanitizer를 흉내내어 차단되는 태그/속성을 표시한다.
 */

'use strict';

// ==========================================================
// 1. 화이트리스트 정의
// ==========================================================

// Roll20 채팅에서 허용되는 HTML 태그 (Roll20 Wiki + 커뮤니티 정리 기반).
const ALLOWED_TAGS = new Set([
  'a', 'b', 'big', 'blockquote', 'br', 'caption', 'cite', 'code',
  'dd', 'del', 'dfn', 'div', 'dl', 'dt', 'em',
  'figcaption', 'figure',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr',
  'i', 'img', 'ins', 'kbd', 'label', 'li', 'mark', 'ol',
  'p', 'pre', 'q', 's', 'samp', 'small', 'span', 'strike',
  'strong', 'sub', 'sup',
  'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr',
  'u', 'ul', 'var',
]);

// 보안상 자식까지 모조리 들어내는 태그.
const DROP_TAGS = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'form', 'input', 'button', 'textarea', 'select', 'option', 'optgroup',
  'meta', 'link', 'base', 'audio', 'video', 'source', 'track',
  'svg', 'canvas', 'noscript', 'applet', 'param', 'fieldset', 'legend',
  'datalist', 'output', 'progress', 'meter', 'details', 'summary',
  'dialog', 'menu', 'template', 'slot',
]);

// 태그별로 살려둘 속성. style/class/title은 모든 태그 공통.
const COMMON_ATTRS = new Set(['class', 'title', 'lang', 'dir', 'id', 'style']);
const TAG_SPECIFIC_ATTRS = {
  a:     ['href', 'target', 'rel', 'name'],
  img:   ['src', 'alt', 'width', 'height'],
  td:    ['colspan', 'rowspan', 'align', 'valign', 'width', 'height'],
  th:    ['colspan', 'rowspan', 'align', 'valign', 'width', 'height', 'scope'],
  table: ['border', 'cellspacing', 'cellpadding', 'align', 'width', 'summary'],
  tr:    ['align', 'valign'],
  thead: ['align', 'valign'],
  tbody: ['align', 'valign'],
  tfoot: ['align', 'valign'],
  col:   ['align', 'valign', 'span', 'width'],
  ol:    ['start', 'type', 'reversed'],
  ul:    ['type'],
  li:    ['value'],
  blockquote: ['cite'],
  q:     ['cite'],
  del:   ['cite', 'datetime'],
  ins:   ['cite', 'datetime'],
  label: ['for'],
};

// Roll20 채팅에서 동작이 검증된 CSS 속성들.
const ALLOWED_CSS_PROPS = new Set([
  // color & background
  'color', 'background', 'background-color', 'background-image',
  'background-position', 'background-repeat', 'background-size',
  'background-attachment', 'background-origin', 'background-clip',
  // font
  'font', 'font-family', 'font-size', 'font-style', 'font-weight',
  'font-variant', 'font-stretch',
  // text
  'text-align', 'text-decoration', 'text-decoration-color',
  'text-decoration-line', 'text-decoration-style',
  'text-indent', 'text-shadow', 'text-transform',
  'line-height', 'letter-spacing', 'word-spacing',
  'white-space', 'word-break', 'word-wrap', 'overflow-wrap',
  'direction', 'unicode-bidi',
  // box
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-top-color', 'border-right-color',
  'border-bottom-color', 'border-left-color',
  'border-style', 'border-top-style', 'border-right-style',
  'border-bottom-style', 'border-left-style',
  'border-width', 'border-top-width', 'border-right-width',
  'border-bottom-width', 'border-left-width',
  'border-radius', 'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-left-radius', 'border-bottom-right-radius',
  'border-image', 'border-image-source', 'border-image-slice',
  'border-image-width', 'border-image-outset', 'border-image-repeat',
  'border-collapse', 'border-spacing', 'empty-cells', 'caption-side',
  'box-shadow', 'box-sizing',
  // size
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  // layout
  'display', 'visibility', 'overflow', 'overflow-x', 'overflow-y',
  'vertical-align', 'float', 'clear', 'opacity',
  // list
  'list-style', 'list-style-type', 'list-style-position', 'list-style-image',
]);

// 명시적으로 채팅에서 동작 안 한다고 알려진 속성들 (warn 시 더 강조).
const KNOWN_BLOCKED_PROPS = new Set([
  'position', 'top', 'right', 'bottom', 'left', 'z-index',
  'flex', 'flex-direction', 'flex-wrap', 'flex-flow', 'flex-grow',
  'flex-shrink', 'flex-basis',
  'align-items', 'align-content', 'align-self',
  'justify-items', 'justify-content', 'justify-self',
  'place-items', 'place-content', 'place-self',
  'order', 'gap', 'row-gap', 'column-gap',
  'grid', 'grid-template', 'grid-template-rows', 'grid-template-columns',
  'grid-template-areas', 'grid-area', 'grid-row', 'grid-column',
  'grid-row-start', 'grid-row-end', 'grid-column-start', 'grid-column-end',
  'grid-auto-rows', 'grid-auto-columns', 'grid-auto-flow', 'grid-gap',
  'transform', 'transform-origin', 'transform-style',
  'perspective', 'perspective-origin', 'backface-visibility',
  'animation', 'animation-name', 'animation-duration', 'animation-delay',
  'animation-direction', 'animation-fill-mode', 'animation-iteration-count',
  'animation-play-state', 'animation-timing-function',
  'transition', 'transition-property', 'transition-duration',
  'transition-delay', 'transition-timing-function',
  'will-change', 'pointer-events', 'cursor', 'user-select',
  'filter', 'backdrop-filter', 'mix-blend-mode', 'isolation',
  'clip', 'clip-path', 'mask', 'mask-image',
  'content', 'counter-reset', 'counter-increment',
  'columns', 'column-count', 'column-width', 'column-gap', 'column-rule',
  'resize', 'object-fit', 'object-position',
  'tab-size', 'scroll-behavior', 'scroll-snap-type',
]);

// display 속성은 일부 값만 통과시킨다.
const ALLOWED_DISPLAY_VALUES = new Set([
  'inline', 'block', 'inline-block', 'list-item', 'none',
  'table', 'table-row', 'table-cell', 'table-caption',
  'table-row-group', 'table-header-group', 'table-footer-group',
  'table-column', 'table-column-group',
]);

// ==========================================================
// 2. Sanitizer 본체
// ==========================================================

class SanitizeReport {
  constructor() {
    this.entries = [];
    this.counts = { tag: 0, prop: 0, value: 0, attr: 0, vendor: 0, security: 0 };
  }
  add(kind, name, reason, detail) {
    this.entries.push({ kind, name, reason, detail });
    this.counts[kind] = (this.counts[kind] || 0) + 1;
  }
  total() { return this.entries.length; }
}

function sanitize(html) {
  const report = new SanitizeReport();
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstElementChild;
  walk(root, report);
  return { html: root.innerHTML, report };
}

function walk(node, report) {
  // 살아있는 children 배열을 그대로 돌면 unwrap/remove 시 인덱스가 어긋난다.
  const children = Array.from(node.children);
  for (const child of children) walk(child, report);

  // root는 자기 자신을 검사하지 않는다 (루트 div는 우리가 감싼 것이므로).
  if (node.parentElement === null) return;

  const tag = node.tagName.toLowerCase();

  if (DROP_TAGS.has(tag)) {
    report.add(
      tag === 'script' || tag === 'iframe' || tag === 'object' || tag === 'embed' ? 'security' : 'tag',
      `<${tag}>`,
      `<${tag}> 태그는 Roll20 채팅에서 차단됩니다 (자식 콘텐츠도 함께 제거).`,
    );
    node.remove();
    return;
  }

  if (!ALLOWED_TAGS.has(tag)) {
    report.add('tag', `<${tag}>`, `<${tag}> 는 Roll20 채팅 화이트리스트에 없어요. 텍스트 내용만 남기고 태그는 풀립니다.`);
    unwrap(node);
    return;
  }

  // 속성 정리
  cleanAttributes(node, report);
}

function cleanAttributes(el, report) {
  const tag = el.tagName.toLowerCase();
  const tagAttrs = new Set(TAG_SPECIFIC_ATTRS[tag] || []);
  const attrs = Array.from(el.attributes);

  for (const attr of attrs) {
    const name = attr.name.toLowerCase();

    // on* 핸들러는 보안상 즉시 제거.
    if (name.startsWith('on')) {
      report.add('security', name, `이벤트 핸들러 속성 ${name} 은 차단됩니다.`);
      el.removeAttribute(attr.name);
      continue;
    }

    // a 태그의 href javascript: 차단
    if (tag === 'a' && name === 'href') {
      const v = attr.value.trim().toLowerCase();
      if (v.startsWith('javascript:') || v.startsWith('data:text/html')) {
        report.add('security', `href="${attr.value}"`, 'javascript: / data:text/html 링크는 차단됩니다.');
        el.removeAttribute(attr.name);
        continue;
      }
    }

    // img src
    if (tag === 'img' && name === 'src') {
      const v = attr.value.trim().toLowerCase();
      if (v.startsWith('javascript:')) {
        report.add('security', `src="${attr.value}"`, 'javascript: 이미지 src는 차단됩니다.');
        el.removeAttribute(attr.name);
        continue;
      }
      // 참고: 실제 Roll20는 imgsrv.roll20.net 호스팅 이미지만 허용
      if (!/^(https?:|imgsrv\.roll20\.net|\/)/.test(v) && !v.startsWith('data:image')) {
        // 동작은 시키되 경고만 남긴다.
      } else if (!v.includes('imgsrv.roll20.net') && v.startsWith('http')) {
        report.add('attr', `<img src="…">`, `Roll20는 imgsrv.roll20.net 호스팅 이미지만 표시해요. 외부 호스팅 이미지는 채팅에서 안 보일 수 있습니다.`, attr.value);
      }
    }

    // style 처리
    if (name === 'style') {
      const cleaned = sanitizeStyle(attr.value, report);
      if (cleaned) {
        el.setAttribute('style', cleaned);
      } else {
        el.removeAttribute('style');
      }
      continue;
    }

    // 일반 속성 화이트리스트
    if (!COMMON_ATTRS.has(name) && !tagAttrs.has(name) && !name.startsWith('data-')) {
      report.add('attr', `${tag}[${name}]`, `<${tag}> 의 ${name} 속성은 허용 목록에 없어 제거되었어요.`);
      el.removeAttribute(attr.name);
    }
  }
}

function unwrap(el) {
  const parent = el.parentNode;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

// ----------------------------------------------------------
// CSS 파싱
// ----------------------------------------------------------

/**
 * style="..." 값을 파싱해서 [{prop, value}] 로 만든다.
 * url(...) 안에 세미콜론이 들어갈 수 있으므로 단순 split이 아닌 상태 머신을 쓴다.
 */
function parseStyleAttr(text) {
  const out = [];
  let buf = '';
  let depth = 0;
  let inStr = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      buf += ch;
      if (ch === inStr && text[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; buf += ch; continue; }
    if (ch === '(') { depth++; buf += ch; continue; }
    if (ch === ')') { depth = Math.max(0, depth - 1); buf += ch; continue; }
    if (ch === ';' && depth === 0) {
      pushDecl(out, buf); buf = ''; continue;
    }
    buf += ch;
  }
  if (buf.trim()) pushDecl(out, buf);
  return out;
}

function pushDecl(arr, raw) {
  const idx = raw.indexOf(':');
  if (idx === -1) return;
  const prop = raw.slice(0, idx).trim().toLowerCase();
  const value = raw.slice(idx + 1).trim();
  if (!prop || !value) return;
  arr.push({ prop, value });
}

function sanitizeStyle(text, report) {
  const decls = parseStyleAttr(text);
  const survived = [];
  for (const { prop, value } of decls) {
    // !important 는 그대로 통과시켜준다 (Roll20도 받음).
    const cleanValue = value;

    // 벤더 프리픽스
    if (prop.startsWith('-webkit-') || prop.startsWith('-moz-') ||
        prop.startsWith('-ms-') || prop.startsWith('-o-')) {
      report.add('vendor', prop, '벤더 프리픽스가 붙은 속성은 Roll20에서 제거됩니다.', `${prop}: ${value}`);
      continue;
    }

    // 명시적 차단 목록 우선 처리
    if (KNOWN_BLOCKED_PROPS.has(prop)) {
      report.add('prop', prop,
        `${prop} 속성은 Roll20 채팅의 sanitizer 화이트리스트에 없어 제거됩니다.`,
        `${prop}: ${value}`);
      continue;
    }

    if (!ALLOWED_CSS_PROPS.has(prop)) {
      report.add('prop', prop,
        `${prop} 속성은 Roll20 채팅에서 알려진 허용 속성이 아니에요. 채팅창에서는 잘릴 가능성이 높아요.`,
        `${prop}: ${value}`);
      continue;
    }

    // display 값 검사
    if (prop === 'display') {
      const v = value.toLowerCase().replace(/\s*!important\s*$/, '').trim();
      if (!ALLOWED_DISPLAY_VALUES.has(v)) {
        report.add('value', `display: ${v}`,
          `display 속성에서 ${v} 값은 Roll20 채팅에서 차단돼요. (block, inline, inline-block, none, table 계열만 통과)`,
          `${prop}: ${value}`);
        continue;
      }
    }

    // url() 안에 javascript: 체크
    if (/url\(\s*['"]?\s*javascript:/i.test(cleanValue)) {
      report.add('security', `${prop}: url(javascript:)`, 'CSS url() 안의 javascript: URL은 차단됩니다.');
      continue;
    }

    // expression() 차단 (구 IE)
    if (/expression\s*\(/i.test(cleanValue)) {
      report.add('security', `${prop}: expression(...)`, 'CSS expression() 은 차단됩니다.');
      continue;
    }

    survived.push(`${prop}: ${cleanValue}`);
  }
  return survived.join('; ');
}

// ==========================================================
// 3. 채팅 렌더링
// ==========================================================

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const state = {
  messages: [],     // 전송된(고정) 메시지들
  preview: null,    // 입력 중인 미리보기
};

function escapeText(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function buildMessage({ type, name, asName, target, html, isPreview }) {
  const wrap = document.createElement('div');
  wrap.className = `chat-msg ${type}`;
  if (isPreview) wrap.classList.add('preview');

  if (isPreview) {
    const tag = document.createElement('span');
    tag.className = 'preview-tag';
    tag.textContent = '미리보기';
    wrap.appendChild(tag);
  }

  if (type === 'whisper') {
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = `(귓속말 → ${target || 'GM'})`;
    wrap.appendChild(meta);
  }

  const displayName =
    type === 'as' ? (asName || 'NPC') :
    type === 'desc' ? '' :
    name || '이름없음';

  if (displayName) {
    const by = document.createElement('span');
    by.className = 'by';
    by.textContent = displayName;
    wrap.appendChild(by);
    wrap.appendChild(document.createTextNode(' '));
  }

  const body = document.createElement('span');
  body.className = 'body';
  body.innerHTML = html;       // 이미 sanitize 된 HTML
  wrap.appendChild(body);

  return wrap;
}

function renderChat() {
  const win = $('#chat-window');
  win.innerHTML = '';
  const items = state.messages.slice();
  if (state.preview) items.push(state.preview);
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = '아직 메시지가 없어요. 왼쪽에 매크로를 입력하면 여기에 미리보기가 나타나요.';
    win.appendChild(empty);
    return;
  }
  for (const m of items) win.appendChild(buildMessage(m));
  win.scrollTop = win.scrollHeight;
}

function renderWarnings(report) {
  const body = $('#warnings-body');
  body.innerHTML = '';
  const total = report.total();
  $('#warn-badge').textContent = String(total);
  $('#warn-badge').dataset.level = total === 0 ? 'ok' : (report.counts.security > 0 ? 'danger' : 'warn');

  if (total === 0) {
    body.innerHTML = '<p class="empty">전부 통과! Roll20 채팅에서도 똑같이 보일 거예요.</p>';
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'warn-summary';
  const parts = [];
  if (report.counts.security) parts.push(`<strong>보안 ${report.counts.security}</strong>`);
  if (report.counts.tag)      parts.push(`<strong>태그 ${report.counts.tag}</strong>`);
  if (report.counts.prop)     parts.push(`<strong>속성 ${report.counts.prop}</strong>`);
  if (report.counts.value)    parts.push(`<strong>값 ${report.counts.value}</strong>`);
  if (report.counts.attr)     parts.push(`<strong>attr ${report.counts.attr}</strong>`);
  if (report.counts.vendor)   parts.push(`<strong>vendor ${report.counts.vendor}</strong>`);
  summary.innerHTML = `차단된 항목 총 ${total}개 — ${parts.join(' · ')}`;
  body.appendChild(summary);

  // 같은 항목 여러 번 잡히면 묶어서 보여준다.
  const grouped = new Map();
  for (const e of report.entries) {
    const key = `${e.kind}::${e.name}`;
    if (!grouped.has(key)) grouped.set(key, { ...e, count: 0 });
    grouped.get(key).count++;
  }

  for (const e of grouped.values()) {
    const el = document.createElement('div');
    el.className = 'warn-item';
    const kindLabelMap = {
      tag: '태그', prop: 'CSS', value: '값', attr: '속성',
      vendor: '벤더', security: '보안',
    };
    el.innerHTML =
      `<span class="label" data-kind="${e.kind}">${kindLabelMap[e.kind] || e.kind}</span>` +
      `<code>${escapeText(e.name)}</code>` +
      (e.count > 1 ? ` <span class="small muted">×${e.count}</span>` : '') +
      (e.reason ? `<span class="reason">${escapeText(e.reason)}</span>` : '');
    body.appendChild(el);
  }
}

// ==========================================================
// 4. 입력 처리
// ==========================================================

const debounce = (fn, ms) => {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
};

function gatherInput() {
  return {
    type:    $('#message-type').value,
    name:    $('#character-name').value.trim() || '이름없음',
    asName:  $('#as-name').value.trim(),
    target:  $('#whisper-target').value.trim(),
    raw:     $('#macro-input').value,
  };
}

function updatePreview() {
  const { type, name, asName, target, raw } = gatherInput();
  if (!raw.trim()) {
    state.preview = null;
    renderChat();
    renderWarnings(new SanitizeReport());
    persist();
    return;
  }
  const { html, report } = sanitize(raw);
  state.preview = { type, name, asName, target, html, isPreview: true };
  renderChat();
  renderWarnings(report);
  persist();
}

function commitMessage() {
  const { type, name, asName, target, raw } = gatherInput();
  if (!raw.trim()) return;
  const { html, report } = sanitize(raw);
  state.messages.push({ type, name, asName, target, html, isPreview: false });
  state.preview = null;
  renderChat();
  renderWarnings(report);
  persist();
}

// ==========================================================
// 5. 영속화 (localStorage)
// ==========================================================

const STORAGE_KEY = 'roll20-tester-v1';

function persist() {
  try {
    const data = {
      input: $('#macro-input').value,
      name:  $('#character-name').value,
      type:  $('#message-type').value,
      asName: $('#as-name').value,
      target: $('#whisper-target').value,
      theme: $('#chat-window').dataset.theme,
      messages: state.messages,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (_) { /* quota / private mode 등 무시 */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.input)  $('#macro-input').value = data.input;
    if (data.name)   $('#character-name').value = data.name;
    if (data.type)   $('#message-type').value = data.type;
    if (data.asName) $('#as-name').value = data.asName;
    if (data.target) $('#whisper-target').value = data.target;
    if (data.theme)  switchTheme(data.theme);
    if (Array.isArray(data.messages)) state.messages = data.messages.map((m) => ({ ...m, isPreview: false }));
    syncTypeVisibility();
  } catch (_) { /* 무시 */ }
}

// ==========================================================
// 6. 샘플 매크로
// ==========================================================

const SAMPLES = [
  {
    title: '컬러 박스',
    desc: '색상·배경·둥근 모서리',
    code:
`<span style="display:inline-block;background:#ffefc7;color:#7a4b00;border:1px solid #d4a13a;padding:4px 10px;border-radius:6px;font-weight:bold;">
  ⚠ 위험! 함정 발견
</span>`,
  },
  {
    title: '대사 박스',
    desc: '둥근 모서리 + 그림자',
    code:
`<div style="background:#fff8ee;border:1px solid #d6c8a4;border-left:4px solid #b3242b;border-radius:6px;padding:10px 14px;margin:4px 0;box-shadow:1px 1px 4px rgba(0,0,0,0.15);">
  <b style="color:#b3242b;">[홍길동]</b> "오늘은 비가 올 것 같군..."
</div>`,
  },
  {
    title: '서술용 액자',
    desc: '가운데 정렬 회상 박스',
    code:
`<div style="background:#1a1816;color:#e6dcc4;text-align:center;padding:14px 18px;border-radius:6px;font-family:serif;font-style:italic;letter-spacing:0.04em;">
  ── 그 일이 일어난 것은, 어느 비 오는 저녁이었다 ──
</div>`,
  },
  {
    title: '주사위 결과 카드',
    desc: '큰 글자 + 라벨',
    code:
`<div style="background:#fff;border:1px solid #ccc;border-radius:6px;padding:10px;text-align:center;">
  <div style="font-size:11px;color:#888;letter-spacing:0.1em;">PERCEPTION</div>
  <div style="font-size:32px;font-weight:bold;color:#b3242b;line-height:1;">17</div>
  <div style="font-size:11px;color:#666;">d20(13) + 4</div>
</div>`,
  },
  {
    title: '테이블',
    desc: '인벤토리 풍',
    code:
`<table style="border-collapse:collapse;width:100%;font-size:13px;">
  <thead>
    <tr style="background:#3a342a;color:#f1e9d0;">
      <th style="padding:4px 8px;text-align:left;">아이템</th>
      <th style="padding:4px 8px;text-align:right;">수</th>
    </tr>
  </thead>
  <tbody>
    <tr><td style="padding:4px 8px;border-bottom:1px solid #ddd;">치료 포션</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #ddd;">3</td></tr>
    <tr><td style="padding:4px 8px;border-bottom:1px solid #ddd;">횃불</td><td style="padding:4px 8px;text-align:right;border-bottom:1px solid #ddd;">5</td></tr>
    <tr><td style="padding:4px 8px;">금화</td><td style="padding:4px 8px;text-align:right;">128</td></tr>
  </tbody>
</table>`,
  },
  {
    title: '⚠ flexbox (안 됨)',
    desc: '경고가 어떻게 뜨는지 보기',
    code:
`<div style="display:flex;gap:10px;align-items:center;justify-content:space-between;background:#fee;padding:10px;">
  <span>왼쪽</span>
  <span>가운데</span>
  <span>오른쪽</span>
</div>`,
  },
  {
    title: '⚠ animation (안 됨)',
    desc: '애니메이션은 잘림',
    code:
`<span style="display:inline-block;color:red;animation:pulse 1s infinite;transform:rotate(5deg);transition:all 0.3s;">
  반짝!
</span>`,
  },
  {
    title: '구분선 + 제목',
    desc: '챕터 헤더',
    code:
`<div style="text-align:center;margin:8px 0;">
  <hr style="border:none;border-top:1px solid #b3242b;margin:6px 0;">
  <span style="font-family:serif;font-size:18px;font-weight:bold;letter-spacing:0.2em;color:#b3242b;">CHAPTER I</span>
  <hr style="border:none;border-top:1px solid #b3242b;margin:6px 0;">
</div>`,
  },
];

function setupSamples() {
  const grid = $('#sample-grid');
  for (const s of SAMPLES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<strong>${escapeText(s.title)}</strong><span>${escapeText(s.desc)}</span>`;
    btn.addEventListener('click', () => {
      $('#macro-input').value = s.code;
      updatePreview();
    });
    grid.appendChild(btn);
  }
}

// ==========================================================
// 7. 치트시트 렌더
// ==========================================================

function renderCheatsheet() {
  $('#cheat-tags').textContent = Array.from(ALLOWED_TAGS).sort().map((t) => `<${t}>`).join(', ');
  $('#cheat-css').textContent = Array.from(ALLOWED_CSS_PROPS).sort().join(', ');
}

// ==========================================================
// 8. 테마 전환
// ==========================================================

function switchTheme(theme) {
  $('#chat-window').dataset.theme = theme;
  for (const tab of $$('.chat-tab')) {
    tab.classList.toggle('active', tab.dataset.theme === theme);
  }
}

// ==========================================================
// 9. 메시지 타입에 따른 가시성
// ==========================================================

function syncTypeVisibility() {
  const t = $('#message-type').value;
  $('.as-only').hidden = t !== 'as';
  $('.whisper-only').hidden = t !== 'whisper';
}

// ==========================================================
// 10. 부트스트랩
// ==========================================================

function setup() {
  setupSamples();
  renderCheatsheet();
  restore();

  const debounced = debounce(updatePreview, 150);
  $('#macro-input').addEventListener('input', debounced);
  $('#character-name').addEventListener('input', debounced);
  $('#as-name').addEventListener('input', debounced);
  $('#whisper-target').addEventListener('input', debounced);
  $('#message-type').addEventListener('change', () => {
    syncTypeVisibility();
    updatePreview();
  });

  $('#send-btn').addEventListener('click', commitMessage);
  $('#clear-input-btn').addEventListener('click', () => {
    $('#macro-input').value = '';
    updatePreview();
  });
  $('#clear-chat-btn').addEventListener('click', () => {
    state.messages = [];
    renderChat();
    persist();
  });
  $('#copy-btn').addEventListener('click', async () => {
    const text = $('#macro-input').value;
    try {
      await navigator.clipboard.writeText(text);
      flashButton($('#copy-btn'), '복사됨!');
    } catch (_) {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); flashButton($('#copy-btn'), '복사됨!'); }
      catch (_) { flashButton($('#copy-btn'), '복사 실패'); }
      document.body.removeChild(ta);
    }
  });

  for (const tab of $$('.chat-tab')) {
    tab.addEventListener('click', () => {
      switchTheme(tab.dataset.theme);
      persist();
    });
  }

  // 키보드 단축키: Ctrl/Cmd + Enter 로 전송
  $('#macro-input').addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      commitMessage();
    }
  });

  updatePreview();
}

function flashButton(btn, msg) {
  const orig = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = orig; }, 1200);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
