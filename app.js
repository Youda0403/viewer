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

// 사용자 매크로의 CSS는 기본적으로 모두 통과시킨다.
// 실제로 안 먹는 속성이 있어도 브라우저가 알아서 무시하므로, 굳이 우리가
// "이건 안 됨"이라고 미리 차단해서 false positive 를 만들 필요는 없다.
// 단, Roll20가 명시적으로 sanitizer에서 막아둔 calc() 와 보안상 위험한
// expression() / url(javascript:…) 만 strip + 경고한다.
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
    // 영문/한글이 있는 경우만 진짜 syntax 오류로 본다.
    // 줄 끝의 길 잃은 " ) ; 같은 건 조용히 무시.
    if (/[a-zA-Z가-힯]/.test(trimmed)) {
      arr.push({ raw: trimmed, invalid: true });
    }
    return;
  }
  const prop = trimmed.slice(0, idx).trim().toLowerCase();
  let value = trimmed.slice(idx + 1).trim();
  if (!prop || !value) return;
  // 매크로 끝의 ;) 패턴: 마크다운 링크의 닫는 ) 가 linear-gradient(...) 의
  // 닫는 ) 로 못 쓰이면서, ; 만 함수 안에 갇혀버리는 경우가 흔하다. CSS 파서는
  // EOF 에서 닫히지 않은 ( 는 자동 보강해주지만, 함수 안에 ; 토큰이 끼면
  // 인자 파싱이 깨져서 속성 자체가 drop 된다. 그 trailing ; 만 떼어내면
  // 브라우저가 함수를 알아서 닫아준다 (Roll20 도 같은 결과로 렌더링됨).
  if (hasUnclosedParen(value)) {
    value = value.replace(/;\s*$/, '').trimEnd();
  }
  arr.push({ prop, value, raw: trimmed });
}

function hasUnclosedParen(s) {
  let depth = 0, inStr = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (ch === inStr && s[i - 1] !== '\\') inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inStr = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
  }
  return depth > 0;
}

function validateDecl(decl, report) {
  if (decl.invalid) {
    report.add('syntax', decl.raw,
      '"속성: 값" 형식이 아니에요. 콜론(:) 누락이거나 세미콜론(;) 위치를 확인하세요.');
    return null;
  }
  const { prop, value } = decl;

  // content 속성은 ::before/::after 의사요소에서만 동작한다. Roll20 매크로의
  // 인라인 style 속성은 실제 요소(<a>)에 붙기 때문에 절대 적용 안 됨.
  if (prop === 'content') {
    report.add('prop', `${prop}: ${value}`,
      'content 속성은 ::before/::after 의사요소에서만 동작해요. ' +
      'Roll20 매크로의 inline style 은 실제 <a> 에 붙어서 무시됩니다.');
    return null;
  }

  // 명시적으로 차단되는 것들만 strip + 경고. 그 외는 모두 통과.
  for (const [key, { re, msg }] of Object.entries(BLOCKED_PATTERNS)) {
    if (re.test(value)) {
      report.add(key === 'calc' ? 'value' : 'security', `${prop}: ${value}`, msg);
      return null;
    }
  }
  return decl;
}

// ============================================================
// 5. Roll20 마크다운 파서
// ============================================================

// (#" 의 # 은 옵셔널 — 사용자 매크로에서 종종 빠진 채로 쓰여도
// 동작하므로 우리도 받아준다.
const STYLE_LINK_RE =
  /\[([^\]]*)\]\(([^)]*?)#?\s*"\s*style\s*=\s*"([^)]*)\)/g;

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
    const prompt = parts[0].trim();
    if (parts.length === 1) return prompt;
    // |default 형태에서 default 가 비어있으면 ?{프롬프트|} 인 셈이라
    // prompt 텍스트로 fallback. 옵션 dropdown(opt,val) 은 첫 옵션의 라벨.
    const def = parts[1].split(',')[0].trim();
    return def || prompt;
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
  html = applyMarkdown(html);

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

function applyMarkdown(html) {
  // 사용자가 매크로 안에서 줄바꿈으로 자주 쓰는 <br>. HTML escape 단계에서
  // &lt;br&gt; 으로 변했을 수 있으니 다시 진짜 <br> 로 복원.
  html = html.replace(/&lt;br\s*\/?\s*&gt;/gi, '<br>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
  html = html.replace(/(^|[^_\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');
  html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
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
  // 링크 텍스트 안에서도 **굵게**, *기울임*, ~~취소~~ 마크다운 처리.
  const text = decodeEntities(p.text);
  const escapedText = applyMarkdown(escapeHtml(text));
  const styleStr = survived.join('; ');
  const prefix = (p.prefix || '').trim();
  const isExternal = /^https?:\/\//i.test(prefix);
  const href = isExternal ? prefix : '#';
  const onclick = isExternal ? '' : ' onclick="return false"';
  const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';
  return `<a class="r20-styled" href="${escapeHtml(href)}"${target}${onclick} style="${escapeHtml(styleStr)}">${escapedText}</a>`;
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
