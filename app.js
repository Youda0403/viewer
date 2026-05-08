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
  // color & background
  'color', 'background', 'background-color', 'background-image',
  'background-size', 'background-position', 'background-repeat',
  'background-attachment', 'background-origin', 'background-clip',
  // font / text
  'font', 'font-family', 'font-size', 'font-weight', 'font-style',
  'font-variant', 'font-stretch',
  'text-decoration', 'text-decoration-line', 'text-decoration-color',
  'text-decoration-style', 'text-decoration-thickness',
  'text-shadow', 'text-align', 'text-indent', 'text-transform',
  'letter-spacing', 'word-spacing', 'line-height',
  'word-break', 'word-wrap', 'overflow-wrap', 'white-space',
  'direction',
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
  'border-collapse', 'border-spacing',
  'box-shadow', 'box-sizing',
  // size / layout
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'display', 'vertical-align', 'visibility', 'opacity',
  'float', 'clear', 'overflow', 'overflow-x', 'overflow-y',
  // list
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

// 명령어 prefix.
const COMMANDS = [
  { name: 'desc', re: /^\/desc\s+/i },
  { name: 'em',   re: /^\/em\s+/i },
  { name: 'em',   re: /^\/me\s+/i },
  { name: 'say',  re: /^\/say\s+/i },
  { name: 'as',   re: /^\/as\s+/i },
];

const ESCAPE_TABLE = [
  ['space (빈칸 여러개)', '&nbsp;'],
  ['%',  '&#37;'],
  ['}',  '&#125;'],
  [')',  '&#41;'],
  ['?',  '&#63;'],
  ['@',  '&#64;'],
  ['[',  '&#91;'],
  [']',  '&#93;'],
  ['|',  '&#124;'],
  ['"',  '&quot;'],
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
const debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// 고유 placeholder 토큰 — 입력에 없는 안전한 문자열.
const PH_OPEN = 'R20';
const PH_CLOSE = '';

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

  // 괄호 짝이 안 맞으면 이스케이프 누락 (rgb(0,0,0) 의 ) 가 마크다운 닫힘으로 잡힌 경우).
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

// [text](URL #" style="DECLS)
// URL 부분(#" 앞)은 비어있어도 되고 매크로 명령/외부 URL이 들어가도 된다.
// lazy 매칭으로 한 줄에 여러 매크로가 연달아 와도 각각 끊어 잡는다.
const STYLE_LINK_RE =
  /\[([^\]]*)\]\(([^)]*?)#\s*"\s*style\s*=\s*"([^)]*)\)/g;

const NORMAL_LINK_RE =
  /\[([^\]]*)\]\(((?:https?:\/\/|mailto:|#)[^)\s]*)\)/g;

function detectCommand(line) {
  for (const c of COMMANDS) {
    if (c.re.test(line)) {
      const rest = line.replace(c.re, '');
      if (c.name === 'as') {
        // /as <speaker> <message>  — 따옴표로 감싼 이름은 공백 포함 허용.
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
  // 1) Roll20 style 링크를 placeholder 로 치환.
  const placeholders = [];
  let work = line.replace(STYLE_LINK_RE, (_, text, prefix, decls) => {
    const i = placeholders.length;
    placeholders.push({ kind: 'styled', text, prefix, decls });
    return `${PH_OPEN}${i}${PH_CLOSE}`;
  });

  // 2) 일반 링크.
  work = work.replace(NORMAL_LINK_RE, (_, text, url) => {
    if (/^javascript:/i.test(url)) {
      report.add('security', `[${text}](${url})`, 'javascript: 링크는 차단됩니다.');
      return text;
    }
    const i = placeholders.length;
    placeholders.push({ kind: 'normal', text, url });
    return `${PH_OPEN}${i}${PH_CLOSE}`;
  });

  // 3) 처리 안 된 [text](...#...) 패턴 — 매크로 트릭이지만 닫힘이 깨진 경우.
  const stray = work.match(/\[[^\]]*\]\([^)]*#[^)]*\)/);
  if (stray) {
    report.add('escape', stray[0],
      '매크로 패턴이 끝까지 닫히지 않은 것 같아요. 값 안의 ) ] " ? @ % 등은 ' +
      '&#41; &#93; &quot; &#63; &#64; &#37; 처럼 escape 해줘야 해요.');
  }

  // 4) HTML escape 후 마크다운 처리.
  let html = escapeHtml(work);
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');

  // 5) placeholder 복원.
  const placeholderRe = new RegExp(
    escapeRegex(PH_OPEN) + '(\\d+)' + escapeRegex(PH_CLOSE),
    'g',
  );
  html = html.replace(placeholderRe, (_m, idx) => {
    const p = placeholders[+idx];
    if (p.kind === 'styled') return renderStyledLink(p, report);
    return renderNormalLink(p);
  });

  return html;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  // prefix 가 진짜 외부 URL이면 클릭 가능하게, 매크로 명령이면 비활성.
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

const state = {
  sent: [],
  preview: [],
};

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
  const all = [...state.sent, ...state.preview];
  if (all.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = '왼쪽에 매크로를 입력하면 여기에 미리보기가 떠요.';
    win.appendChild(empty);
    return;
  }
  for (const m of all) win.appendChild(buildMsgEl(m));
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

function renderCheatsheet() {
  const body = $('#cheatsheet-body');
  body.innerHTML =
    '<h3>되는 속성 (블로그 검증)</h3>' +
    '<p class="mono small">' +
      Array.from(ALLOWED_PROPS).sort().join(', ') +
    '</p>' +
    '<h3>막혀있거나 의심스러운 것</h3>' +
    '<ul>' +
      '<li><code>calc(…)</code> — Roll20에서 명시적으로 막아놓음</li>' +
      '<li><code>url(javascript:…)</code>, <code>expression(…)</code> — 보안 차단</li>' +
      '<li>벤더 프리픽스(<code>-webkit-</code> 등) — 보장 안 됨</li>' +
      '<li>화이트리스트에 없는 속성은 안 먹힐 수 있음 (경고로 표시)</li>' +
    '</ul>' +
    '<h3>특수문자 이스케이프</h3>' +
    '<table><thead><tr><th>문자</th><th>엔티티</th></tr></thead><tbody>' +
      ESCAPE_TABLE.map(([c, e]) =>
        `<tr><td><code>${escapeHtml(c)}</code></td><td><code>${escapeHtml(e)}</code></td></tr>`
      ).join('') +
    '</tbody></table>' +
    '<p class="small muted" style="margin-top:8px;">' +
      '값 안의 <code>)</code> 같은 특수문자는 마크다운 링크 닫힘으로 오해되기 때문에 ' +
      '반드시 위 엔티티로 바꿔주세요.' +
    '</p>';
}

// ============================================================
// 8. 영속화
// ============================================================

const STORAGE_KEY = 'roll20-chat-preview-v3';

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      input: $('#macro-input').value,
      sent: state.sent,
    }));
  } catch (_) { /* 무시 */ }
}
function restore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!data) return;
    if (data.input) $('#macro-input').value = data.input;
    if (Array.isArray(data.sent)) state.sent = data.sent;
  } catch (_) { /* 무시 */ }
}

// ============================================================
// 9. 샘플
// ============================================================

const SAMPLES = [
  {
    title: '기본 색상 + 굵기',
    desc: '단순한 컬러 텍스트',
    code: `[두근두근…](#" style="color:#b3242b; font-weight:bold; text-decoration:none;)`,
  },
  {
    title: '서술 (/desc)',
    desc: '가운데 정렬, 기본 italic+bold',
    code: `/desc [── 그 일이 일어난 것은, 어느 비 오는 저녁이었다 ──](#" style="color:#666; text-decoration:none;)`,
  },
  {
    title: '/as 다른 사람으로',
    desc: '옅은 푸른색 박스',
    code: `/as 시벨 안녕하세요, 처음 뵙겠습니다.`,
  },
  {
    title: '/as + 스타일',
    desc: '/as 도 [내용](#"…) 와 같이 쓸 수 있어요',
    code: `/as NPC [의뢰가 있다](#" style="color:#1f4d7a; font-weight:bold;)`,
  },
  {
    title: '대사 박스',
    desc: '테두리 + 둥근 모서리 + 패딩',
    code: `[ "오늘은 비가 올 것 같군…" ](#" style="display:inline-block; background-color:#fff8ee; border:1px solid #d6c8a4; border-left:4px solid #b3242b; border-radius:6px; padding:6px 10px; color:#333; text-decoration:none;)`,
  },
  {
    title: '잡담 (회색 흐릿)',
    desc: 'Gainsboro + text-decoration:none',
    code: `[(저 오늘 시험 망했어요…)](#" style="color:Gainsboro; text-decoration:none;)`,
  },
  {
    title: '큰 헤더',
    desc: 'font-size + letter-spacing',
    code: `[CHAPTER I](#" style="font-size:18px; font-weight:bold; letter-spacing:0.2em; color:#b3242b; text-decoration:none;)`,
  },
  {
    title: '선택지 매크로 버튼',
    desc: 'URL 부분에 매크로를 넣어 클릭 시 실행',
    code: `/desc [어떻게 할까?](#" style="text-decoration:none; font-weight:bold;)[ ▶ 손을 잡는다](!&#13;/desc 손을 잡았다. #" style="text-decoration:none; display:block; color:#fff; background:#0d0d0d; border-radius:20px; padding:5px 15px; text-align:left;)[ ▶ 거절한다](!&#13;/desc 거절했다. #" style="text-decoration:none; display:block; color:#fff; background:#5a0d0d; border-radius:20px; padding:5px 15px; text-align:left; margin-top:3px;)`,
  },
  {
    title: '⚠ calc() 차단 시연',
    desc: '경고가 어떻게 뜨는지',
    code: `[테스트](#" style="width:calc&#40;100% - 20px&#41;; color:red;)`,
  },
  {
    title: '⚠ 이스케이프 누락 시연',
    desc: ') 가 그대로일 때',
    code: `[빨강](#" style="background:rgb(255,0,0);)`,
  },
];

function setupSamples() {
  const grid = $('#sample-grid');
  for (const s of SAMPLES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `<strong>${escapeHtml(s.title)}</strong><span>${escapeHtml(s.desc)}</span>`;
    btn.addEventListener('click', () => {
      $('#macro-input').value = s.code;
      update();
    });
    grid.appendChild(btn);
  }
}

// ============================================================
// 10. 부트
// ============================================================

function update() {
  const txt = $('#macro-input').value;
  if (!txt.trim()) {
    state.preview = [];
    renderChat();
    renderWarnings(new SanitizeReport());
    persist();
    return;
  }
  const { messages, report } = processInput(txt);
  state.preview = messages;
  renderChat();
  renderWarnings(report);
  persist();
}

function commit() {
  const txt = $('#macro-input').value;
  if (!txt.trim()) return;
  const { messages } = processInput(txt);
  if (!messages.length) return;
  state.sent.push(...messages);
  $('#macro-input').value = '';
  update();
}

function setup() {
  setupSamples();
  renderCheatsheet();
  restore();

  const debounced = debounce(update, 120);
  $('#macro-input').addEventListener('input', debounced);
  $('#macro-input').addEventListener('keydown', (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 'Enter') {
      ev.preventDefault();
      commit();
    }
  });
  $('#send-btn').addEventListener('click', commit);
  $('#clear-input-btn').addEventListener('click', () => {
    $('#macro-input').value = '';
    update();
  });
  $('#clear-chat-btn').addEventListener('click', () => {
    state.sent = [];
    renderChat();
    persist();
  });

  update();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
