/**
 * Roll20 채팅 미리보기.
 *
 * 입력 형식: [내용](URL #" style="prop: value; …)  형태의 Roll20 마크다운 트릭.
 * URL 부분은 비어있을 수도, 매크로 명령(!&#13;/desc …)이나 외부 URL일 수도 있다.
 *
 * 출처: danharu0920 블로그(롤꾸용 CSS 입문),
 *       베베까까 블로그(Roll20 채팅로그 꾸미기 / 롤꾸하는데 도움되는 CSS 모음).
 */
'use strict';

// ============================================================
// 1. 화이트리스트 / 차단 패턴
// ============================================================

const ALLOWED_PROPS = new Set([
  'color', 'background', 'background-color', 'background-image',
  'background-size', 'background-position', 'background-repeat',
  'background-attachment', 'background-origin', 'background-clip',
  'font', 'font-family', 'font-size', 'font-weight', 'font-style',
  'font-variant', 'font-stretch',
  'text-decoration', 'text-decoration-line', 'text-decoration-color',
  'text-decoration-style', 'text-decoration-thickness',
  'text-shadow', 'text-align', 'text-indent', 'text-transform',
  'letter-spacing', 'word-spacing', 'line-height',
  'word-break', 'word-wrap', 'overflow-wrap', 'white-space',
  'direction',
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
  'border-collapse', 'border-spacing',
  'box-shadow', 'box-sizing',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'display', 'vertical-align', 'visibility', 'opacity',
  'float', 'clear', 'overflow', 'overflow-x', 'overflow-y',
  'list-style', 'list-style-type', 'list-style-position', 'list-style-image',
]);

const BLOCKED_PATTERNS = {
  calc:       { re: /\bcalc\s*\(/i,
                msg: 'Roll20는 calc() 수식을 막아놨어요. 고정값으로 바꿔주세요.' },
  expression: { re: /\bexpression\s*\(/i,
                msg: 'CSS expression() 은 차단됩니다.' },
  jsurl:      { re: /url\s*\(\s*['"]?\s*javascript:/i,
                msg: 'url(javascript:…) 는 차단됩니다.' },
};

const COMMANDS = [
  { name: 'desc', re: /^\/desc\s+/i },
  { name: 'as',   re: /^\/as\s+/i },
];

// ============================================================
// 2. 유틸
// ============================================================

const $ = (sel) => document.querySelector(sel);

const _entityHelper = document.createElement('textarea');
function decodeEntities(s) {
  _entityHelper.innerHTML = String(s);
  return _entityHelper.value;
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// 입력에 등장 가능성 매우 낮은 placeholder 토큰.
const PH_OPEN = '\x01R20\x01';
const PH_CLOSE = '\x01';

// ============================================================
// 3. SanitizeReport
// ============================================================

class SanitizeReport {
  constructor() { this.entries = []; this.counts = {}; }
  add(kind, name, reason) {
    this.entries.push({ kind, name, reason });
    this.counts[kind] = (this.counts[kind] || 0) + 1;
  }
  total() { return this.entries.length; }
}
const KIND_LABEL = {
  prop: '속성', value: '값', syntax: '문법',
  escape: '이스케이프', security: '보안',
};

// ============================================================
// 4. CSS 파서
// ============================================================

function parseDecls(text) {
  const out = [];
  let buf = '', depth = 0, inStr = null;
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
    if (ch === ';' && depth === 0) { pushDecl(out, buf); buf = ''; continue; }
    buf += ch;
  }
  if (buf.trim()) pushDecl(out, buf);
  return out;
}

function pushDecl(arr, raw) {
  const trimmed = raw.trim();
  if (!trimmed) return;
  const idx = trimmed.indexOf(':');
  if (idx === -1) {
    arr.push({ raw: trimmed, invalid: true });
    return;
  }
  const prop = trimmed.slice(0, idx).trim().toLowerCase();
  const value = trimmed.slice(idx + 1).trim();
  if (!prop || !value) {
    arr.push({ raw: trimmed, invalid: true });
    return;
  }
  arr.push({ prop, value, raw: trimmed });
}

function validateDecl(decl, report) {
  if (decl.invalid) {
    report.add('syntax', decl.raw,
      '"속성: 값" 형식이 아니에요. 콜론(:) 누락이거나 세미콜론(;) 위치가 잘못됐을 수 있어요.');
    return null;
  }
  const { prop, value } = decl;

  const opens = (value.match(/\(/g) || []).length;
  const closes = (value.match(/\)/g) || []).length;
  if (opens !== closes) {
    report.add('escape', `${prop}: ${value}`,
      '괄호 짝이 안 맞아요. 값 안의 ) 는 &#41; 로, ( 는 &#40; 로 이스케이프해주세요.');
    return null;
  }

  for (const [key, { re, msg }] of Object.entries(BLOCKED_PATTERNS)) {
    if (re.test(value)) {
      report.add(key === 'calc' ? 'value' : 'security', `${prop}: ${value}`, msg);
      return null;
    }
  }

  if (!ALLOWED_PROPS.has(prop)) {
    if (/^-(webkit|moz|ms|o)-/.test(prop)) {
      report.add('prop', prop,
        '벤더 프리픽스는 Roll20 채팅에서 동작이 보장되지 않아요.');
    } else {
      report.add('prop', prop,
        `${prop} 은 두 블로그가 검증한 속성 목록에 없어요. Roll20에서 안 먹힐 수 있습니다.`);
    }
    return decl;
  }
  return decl;
}

// ============================================================
// 5. Roll20 마크다운 파서
// ============================================================

const STYLE_LINK_RE =
  /\[([^\]]*)\]\(([^)]*?)#\s*"\s*style\s*=\s*"([^)]*)\)/g;

const NORMAL_LINK_RE =
  /\[([^\]]*)\]\(((?:https?:\/\/|mailto:|#)[^)\s]*)\)/g;

// 이미지 URL 자동 인식 (확장자 기반).
const IMAGE_URL_RE =
  /(https?:\/\/[^\s<>"'()]+\.(?:png|jpe?g|gif|webp|svg|bmp))(\?[^\s<>"'()]*)?/gi;

// 백틱 인라인 코드 — Roll20는 더블 백틱(``text``) 만 코드로 처리한다.
// 단일 백틱은 일반 본문에서 흔히 쓰이므로 코드로 잡지 않는다.
const BACKTICK_RE = /``([^`\n]+?)``/g;

// Roll20 query: ?{prompt}, ?{prompt|default}, ?{prompt|opt1|opt2}.
const QUERY_RE = /\?\{([^}]+)\}/g;

function substituteQueries(text) {
  return text.replace(QUERY_RE, (_m, inner) => {
    const parts = inner.split('|');
    if (parts.length === 1) return parts[0].trim();
    // |default 형태면 default 표시, 옵션 dropdown(opt,val)면 첫 옵션의 라벨.
    const second = parts[1];
    return second.split(',')[0].trim();
  });
}

function detectCommand(line) {
  for (const c of COMMANDS) {
    if (c.re.test(line)) {
      const rest = line.replace(c.re, '');
      if (c.name === 'as') {
        const m = rest.match(/^("[^"]+"|'[^']+'|\S+)\s*([\s\S]*)$/);
        const speaker = m ? m[1].replace(/^["']|["']$/g, '') : '';
        const body = m ? m[2] : rest;
        return { name: 'as', speaker, rest: body };
      }
      return { name: c.name, rest };
    }
  }
  return { name: 'say', rest: line };
}

function processInline(line, report) {
  // 0) ?{질문} 치환 — 가장 먼저 (다른 패턴 안에도 들어있을 수 있음).
  let work = substituteQueries(line);

  // 1) Roll20 styled link → placeholder
  const placeholders = [];
  work = work.replace(STYLE_LINK_RE, (_, text, prefix, decls) => {
    const i = placeholders.length;
    placeholders.push({ kind: 'styled', text, prefix, decls });
    return `${PH_OPEN}${i}${PH_CLOSE}`;
  });

  // 2) 일반 마크다운 링크 → placeholder
  work = work.replace(NORMAL_LINK_RE, (_, text, url) => {
    if (/^javascript:/i.test(url)) {
      report.add('security', `[${text}](${url})`, 'javascript: 링크는 차단됩니다.');
      return text;
    }
    const i = placeholders.length;
    placeholders.push({ kind: 'normal', text, url });
    return `${PH_OPEN}${i}${PH_CLOSE}`;
  });

  // 3) 미처 들어가지 못한 이미지 URL → <img>
  work = work.replace(IMAGE_URL_RE, (_m, base, query) => {
    const url = base + (query || '');
    const i = placeholders.length;
    placeholders.push({ kind: 'image', url });
    return `${PH_OPEN}${i}${PH_CLOSE}`;
  });

  // 4) 백틱 인라인 코드(``text``) → placeholder
  work = work.replace(BACKTICK_RE, (_m, code) => {
    const i = placeholders.length;
    placeholders.push({ kind: 'code', code });
    return `${PH_OPEN}${i}${PH_CLOSE}`;
  });

  // 5) 처리 안 된 [text](...#...) — 매크로 트릭이지만 escape 깨짐
  const stray = work.match(/\[[^\]]*\]\([^)]*#[^)]*\)/);
  if (stray) {
    report.add('escape', stray[0],
      '매크로 패턴이 끝까지 닫히지 않은 것 같아요. 값 안의 ) ] " ? @ % 등은 ' +
      '&#41; &#93; &quot; &#63; &#64; &#37; 처럼 escape 해줘야 해요.');
  }

  // 6) HTML escape + 마크다운 처리
  let html = escapeHtml(work);
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // 7) placeholder 복원
  const placeholderRe = new RegExp(
    escapeRegex(PH_OPEN) + '(\\d+)' + escapeRegex(PH_CLOSE),
    'g',
  );
  html = html.replace(placeholderRe, (_m, idx) => {
    const p = placeholders[+idx];
    switch (p.kind) {
      case 'styled': return renderStyledLink(p, report);
      case 'normal': return renderNormalLink(p);
      case 'image':  return renderImage(p);
      case 'code':   return renderCode(p);
    }
    return '';
  });

  return html;
}

function renderStyledLink(p, report) {
  const decoded = decodeEntities(p.decls);
  const decls = parseDecls(decoded);
  const survived = [];
  for (const d of decls) {
    const ok = validateDecl(d, report);
    if (ok) survived.push(`${ok.prop}: ${ok.value}`);
  }
  const text = decodeEntities(p.text);
  const styleStr = survived.join('; ');
  const prefix = (p.prefix || '').trim();
  const isExternal = /^https?:\/\//i.test(prefix);
  const href = isExternal ? prefix : '#';
  const onclick = isExternal ? '' : ' onclick="return false"';
  const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a class="r20-styled" href="${escapeHtml(href)}"${target}${onclick} style="${escapeHtml(styleStr)}">${escapeHtml(text)}</a>`;
}

function renderNormalLink(p) {
  return `<a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(decodeEntities(p.text))}</a>`;
}

function renderImage(p) {
  return `<img class="r20-image" src="${escapeHtml(p.url)}" alt="" loading="lazy">`;
}

function renderCode(p) {
  return `<code class="r20-code">${escapeHtml(decodeEntities(p.code))}</code>`;
}

// ============================================================
// 6. 메시지 처리
// ============================================================

function processMessage(line, report) {
  if (!line.trim()) return null;
  const cmd = detectCommand(line);
  const html = processInline(cmd.rest, report);
  return { type: cmd.name, html, speaker: cmd.speaker || '' };
}

function processInput(text) {
  const report = new SanitizeReport();
  const messages = [];
  for (const line of text.split('\n')) {
    const m = processMessage(line, report);
    if (m) messages.push(m);
  }
  return { messages, report };
}

// ============================================================
// 7. 렌더링
// ============================================================

const state = { messages: [] };

function buildMsgEl({ type, html, speaker }) {
  const el = document.createElement('div');
  el.className = `chat-msg ${type}`;
  if (type === 'as' && speaker) {
    const by = document.createElement('span');
    by.className = 'by';
    by.textContent = speaker;
    el.appendChild(by);
    el.appendChild(document.createTextNode(' '));
  }
  const body = document.createElement('span');
  body.className = 'body';
  body.innerHTML = html;
  el.appendChild(body);
  return el;
}

function renderChat() {
  const win = $('#chat-window');
  win.innerHTML = '';
  if (state.messages.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = '왼쪽에 매크로를 입력하면 여기에 미리보기가 떠요.';
    win.appendChild(empty);
    return;
  }
  for (const m of state.messages) win.appendChild(buildMsgEl(m));
  win.scrollTop = win.scrollHeight;
}

function renderWarnings(report) {
  const body = $('#warnings-body');
  body.innerHTML = '';
  const total = report.total();
  $('#warn-badge').textContent = String(total);
  $('#warn-badge').dataset.level =
    total === 0 ? 'ok' : (report.counts.security ? 'danger' : 'warn');

  if (total === 0) {
    body.innerHTML = '<p class="empty">전부 통과! Roll20에서도 똑같이 보일 거예요.</p>';
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'warn-summary';
  const order = ['security', 'syntax', 'escape', 'prop', 'value'];
  const parts = [];
  for (const k of order) {
    if (report.counts[k]) parts.push(`<strong>${KIND_LABEL[k]} ${report.counts[k]}</strong>`);
  }
  summary.innerHTML = `차단/경고 ${total}건 — ${parts.join(' · ')}`;
  body.appendChild(summary);

  const grouped = new Map();
  for (const e of report.entries) {
    const k = `${e.kind}::${e.name}::${e.reason}`;
    if (!grouped.has(k)) grouped.set(k, { ...e, count: 0 });
    grouped.get(k).count++;
  }
  for (const e of grouped.values()) {
    const item = document.createElement('div');
    item.className = 'warn-item';
    item.innerHTML =
      `<span class="label" data-kind="${e.kind}">${KIND_LABEL[e.kind] || e.kind}</span>` +
      `<code>${escapeHtml(e.name)}</code>` +
      (e.count > 1 ? ` <span class="muted small">×${e.count}</span>` : '') +
      `<span class="reason">${escapeHtml(e.reason)}</span>`;
    body.appendChild(item);
  }
}

// ============================================================
// 8. 영속화
// ============================================================

const STORAGE_KEY = 'roll20-chat-preview-v4';

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      input: $('#macro-input').value,
    }));
  } catch (_) { /* 무시 */ }
}
function restore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!data) return;
    if (data.input) $('#macro-input').value = data.input;
  } catch (_) { /* 무시 */ }
}

// ============================================================
// 9. 부트
// ============================================================

function update() {
  const txt = $('#macro-input').value;
  if (!txt.trim()) {
    state.messages = [];
    renderChat();
    renderWarnings(new SanitizeReport());
    persist();
    return;
  }
  const { messages, report } = processInput(txt);
  state.messages = messages;
  renderChat();
  renderWarnings(report);
  persist();
}

async function copyMacro() {
  const text = $('#macro-input').value;
  if (!text) return;
  const btn = $('#copy-btn');
  const original = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = '복사됨!';
  } catch (_) {
    // file:// / 권한 없는 환경 fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { /* 무시 */ }
    document.body.removeChild(ta);
    btn.textContent = ok ? '복사됨!' : '복사 실패';
  }
  setTimeout(() => { btn.textContent = original; }, 1200);
}

function setup() {
  restore();

  const debounced = debounce(update, 120);
  $('#macro-input').addEventListener('input', debounced);

  $('#copy-btn').addEventListener('click', copyMacro);
  $('#clear-input-btn').addEventListener('click', () => {
    $('#macro-input').value = '';
    update();
  });

  update();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
