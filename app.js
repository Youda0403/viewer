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
// 1. 차단 패턴
// ============================================================

// 사용자 매크로의 CSS는 기본적으로 모두 통과시킨다.
// 실제로 안 먹는 속성이 있어도 브라우저가 알아서 무시하므로, 굳이 우리가
// "이건 안 됨"이라고 미리 차단해서 false positive 를 만들 필요는 없다.
// 단, Roll20가 명시적으로 sanitizer에서 막아둔 calc() 와 보안상 위험한
// expression() / url(javascript:…) 만 조용히 걷어낸다.
const BLOCKED_VALUE_RE = [
  /\bcalc\s*\(/i,                    // Roll20 sanitizer 가 막는 수식
  /\bexpression\s*\(/i,              // 구형 IE CSS 표현식
  /url\s*\(\s*['"]?\s*javascript:/i, // js URL
];

const COMMANDS = [
  { name: 'desc', re: /^\/desc\s+/i },
  { name: 'as',   re: /^\/as\s+/i },
];

// ============================================================
// 2. 유틸
// ============================================================

const $ = (sel) => document.querySelector(sel);

// iOS/macOS 의 "Smart Quotes" 가 textarea 붙여넣기에서 ASCII " 를 “ ” 로
// 바꿔버리면 Roll20 의 style="..." 파서가 매크로를 못 잡는다. 보이지 않는
// 변환이라 사용자가 알아채기 어렵다 — 입력/붙여넣기 단계에서 ASCII 로
// 강제로 되돌린다. NBSP( ) 도 종종 끼어들어서 같이 처리.
const SMART_CHARS_RE = /[“”„‟‘’‚‛ ]/g;
const SMART_MAP = {
  '“': '"', '”': '"', '„': '"', '‟': '"',
  '‘': "'", '’': "'", '‚': "'", '‛': "'",
  ' ': ' ',
};
function normalizeQuotes(s) {
  return String(s).replace(SMART_CHARS_RE, (c) => SMART_MAP[c] || c);
}

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

// 전역 상태. 쿼리 응답은 "?{…}" 원문을 키로 저장한다 — 매크로를 고치면
// 키가 달라지므로 예전 답이 엉뚱하게 재사용될 일이 없다.
const state = { messages: [], answers: {}, queryKeys: '' };

// ============================================================
// 3. CSS 파서
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
  if (idx === -1) return;
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
  arr.push({ prop, value });
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

function keepDecl({ prop, value }) {
  // content 속성은 ::before/::after 의사요소에서만 동작한다. Roll20 매크로의
  // 인라인 style 속성은 실제 요소(<a>)에 붙기 때문에 절대 적용 안 됨.
  if (prop === 'content') return false;
  return !BLOCKED_VALUE_RE.some((re) => re.test(value));
}

// ============================================================
// 4. Roll20 쿼리 ?{…}
// ============================================================
//
// Roll20 는 메시지를 보낼 때 ?{…} 를 팝업으로 물어보고, 사용자가 고른
// "값"으로 치환한 다음 그 결과를 마크다운/CSS 파서에 태운다. 그래서
//
//   ?{퍼센트| 100%,[100%](#" style="…background-color: #C9151E&#41;| …}
//
// 처럼 선택지의 "값" 쪽에 통째로 스타일 링크를 넣는 매크로가 성립한다.
// 이때 값 안의 ) , | 는 쿼리 파서에 먹히지 않도록 &#41; &#44; &#124; 로
// 이스케이프해서 쓰고, 치환 시점에 실제 문자로 복원된다.
//
// 예전 구현은 "라벨"을 그대로 본문에 꽂아버려서(→ 그냥 "100%" 텍스트)
// 선택지형 매크로가 전부 죽어 있었다. 이제 값을 쓰고 엔티티를 풀어준다.

const QUERY_RE = /\?\{([^{}]+)\}/g;

function parseQuery(raw, inner) {
  const parts = inner.split('|');
  const prompt = parts[0].trim() || '입력';
  const rest = parts.slice(1);

  // Roll20 규칙: 선택지가 2개 이상이거나, 하나뿐이어도 "라벨,값" 형태면
  // 드롭다운. 그 외에는 기본값이 채워진 자유 입력.
  const isSelect = rest.length > 1 || (rest.length === 1 && rest[0].includes(','));
  if (!isSelect) {
    return { key: raw, prompt, type: 'text', def: decodeEntities(rest[0] || '') };
  }
  const options = rest.map((part) => {
    const i = part.indexOf(',');
    const label = (i === -1 ? part : part.slice(0, i)).trim();
    const value = i === -1 ? part : part.slice(i + 1);
    return { label: label || '(이름 없음)', value: decodeEntities(value) };
  });
  return { key: raw, prompt, type: 'select', options };
}

function collectQueries(text) {
  const out = [];
  const seen = new Set();
  QUERY_RE.lastIndex = 0;
  let m;
  while ((m = QUERY_RE.exec(text)) !== null) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    out.push(parseQuery(m[0], m[1]));
  }
  return out;
}

function answerFor(q) {
  const saved = state.answers[q.key];
  if (q.type === 'text') return typeof saved === 'string' ? saved : q.def;
  const idx = Number.isInteger(saved) && q.options[saved] ? saved : 0;
  return q.options[idx] ? q.options[idx].value : '';
}

function substituteQueries(text) {
  return text.replace(QUERY_RE, (raw, inner) => answerFor(parseQuery(raw, inner)));
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

// 스타일 없는 명령 버튼: [굴림](!&#13;/roll 1d20) / [능력](~char|ability).
// 명령 안에 공백이 흔해서 NORMAL_LINK_RE 로는 안 잡힌다.
const COMMAND_LINK_RE = /\[([^\]]*)\]\(([!~][^)]*)\)/g;

// 이미지 URL 자동 인식 (확장자 기반).
// http(s):// 없이 i.imgur.com/xxx.png 처럼 도메인부터 쓴 주소도 받는다.
// 이 경우 오탐을 막기 위해 "도메인.TLD/경로" 형태(슬래시 필수)일 때만 인정하고,
// 단어/경로 한가운데서 시작하는 매치는 (?<!…) 로 걸러낸다.
const IMAGE_URL_RE =
  /((?:https?:\/\/|(?<![\w.\/@:-])(?=(?:[a-z0-9-]+\.)+[a-z]{2,}\/))[^\s<>"'()]+\.(?:png|jpe?g|gif|webp|svg|bmp))(\?[^\s<>"'()]*)?/gi;

// 백틱 인라인 코드 — Roll20는 더블 백틱(``text``) 만 코드로 처리한다.
// 단일 백틱은 일반 본문에서 흔히 쓰이므로 코드로 잡지 않는다.
const BACKTICK_RE = /``([^`\n]+?)``/g;

// Roll20 에서 "명령 버튼"이 되는 링크 대상. ! = API 명령, ~ = 매크로/능력,
// / = 채팅 명령. 이 셋은 Roll20 가 기본 버튼 스타일(inline-block + padding)
// 을 입혀서 그리기 때문에 우리도 똑같이 취급해야 한다. (#" 트릭은 해당 없음)
const COMMAND_PREFIX_RE = /^[!~/]/;

// 인라인 흐름에서 빠지는 요소 / 줄을 끊는 요소.
const OUT_OF_FLOW_RE = /^(absolute|fixed)$/;
const BLOCK_DISPLAY_RE = /^(block|flex|grid|table|list-item|flow-root)$/;

function styleFlags(decls) {
  let outOfFlow = false, blockLevel = false;
  for (const { prop, value } of decls) {
    const v = value.trim().toLowerCase();
    if (prop === 'position' && OUT_OF_FLOW_RE.test(v)) outOfFlow = true;
    if (prop === 'display' && BLOCK_DISPLAY_RE.test(v)) blockLevel = true;
  }
  return { outOfFlow, blockLevel };
}

/**
 * position:absolute 요소 주변의 공백을 직접 접는다.
 *
 * 겹치기 매크로(하트 편지봉투처럼 <a> 몇 개를 음수 margin 으로 포개는 것)는
 * absolute 요소의 "static position" 을 기준으로 좌표를 잡는다. 그 기준점은
 * 앞선 인라인 내용의 폭에 달려 있는데, absolute 요소는 줄에 폭을 기여하지
 * 않으므로 그 주변 공백은 서로 이웃하게 되어 접혀야 한다 — 데스크톱 Chrome
 * 은 접어서 폭 0 으로 만들지만, 일부 모바일 엔진은 공백을 그대로 남긴다.
 * 남으면 뒤따르는 겹치기 요소가 공백 폭만큼 누적으로 밀려서(뚜껑 +3.6px,
 * 그 다음 +7.3px, 하트 +13.2px …) 매크로가 어긋나 보인다.
 *
 * 엔진의 공백 처리에 기대지 않고, 애초에 DOM 에 공백 문자를 남기지 않는다.
 * 단, 접은 결과로 양옆의 "흐름에 남은" 내용이 붙어버리면 안 되므로 그때는
 * 공백 하나를 되돌려 놓는다 (줄 시작/끝이나 블록 요소와 맞닿는 경우는 제외 —
 * 그 공백은 어차피 사라지는 자리다).
 */
function collapseOutOfFlowGaps(work, placeholders) {
  const tokenRe = new RegExp(
    escapeRegex(PH_OPEN) + '(\\d+)' + escapeRegex(PH_CLOSE), 'g',
  );
  const items = [];
  let last = 0, m;
  while ((m = tokenRe.exec(work)) !== null) {
    if (m.index > last) items.push({ s: work.slice(last, m.index) });
    items.push({ s: m[0], p: placeholders[+m[1]] });
    last = m.index + m[0].length;
  }
  if (last < work.length) items.push({ s: work.slice(last) });

  const isOof = (it) => !!(it && it.p && it.p.outOfFlow);
  if (!items.some(isOof)) return work;

  const isWs = (it) => !!it && !it.p && /^\s+$/.test(it.s);
  // 줄 시작/끝, 또는 줄을 끊는 블록 요소 — 옆 공백이 어차피 없어지는 자리.
  const isEdge = (it) => !it || !!(it.p && it.p.blockLevel);

  const out = [];
  for (let i = 0; i < items.length; i++) {
    if (!isWs(items[i]) && !isOof(items[i])) { out.push(items[i]); continue; }

    // out-of-flow 요소와 공백으로만 이뤄진 최대 구간을 잡는다.
    let j = i, hasOof = false, hasWs = false;
    for (; j < items.length && (isWs(items[j]) || isOof(items[j])); j++) {
      if (isWs(items[j])) hasWs = true; else hasOof = true;
    }
    if (!hasOof) {                       // 그냥 공백뿐이면 손대지 않는다
      for (let k = i; k < j; k++) out.push(items[k]);
    } else {
      // 공백 시퀀스에서 살아남는 건 "첫 번째" 하나다 (브라우저와 동일).
      // 그러니 되돌릴 공백은 out-of-flow 토큰들 앞에 놓는다 — 그래야
      // absolute 요소의 static position 도 브라우저와 같은 자리에 온다.
      if (hasWs && !isEdge(out[out.length - 1]) && !isEdge(items[j])) {
        out.push({ s: ' ' });
      }
      for (let k = i; k < j; k++) if (isOof(items[k])) out.push(items[k]);
    }
    i = j - 1;
  }
  return out.map((it) => it.s).join('');
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

function processInline(line) {
  // 0) ?{질문} 치환 — 가장 먼저. 치환 결과 자체가 스타일 링크일 수 있으므로
  //    반드시 아래 링크 파싱보다 앞서야 한다.
  let work = substituteQueries(line);

  // 1) Roll20 styled link → placeholder
  //    CSS 는 여기서 미리 파싱한다 — 아래 공백 접기가 position/display 를
  //    알아야 하기 때문.
  const placeholders = [];
  work = work.replace(STYLE_LINK_RE, (_, text, prefix, declText) => {
    const decls = parseDecls(decodeEntities(declText)).filter(keepDecl);
    const i = placeholders.length;
    placeholders.push({ kind: 'styled', text, prefix, decls, ...styleFlags(decls) });
    return `${PH_OPEN}${i}${PH_CLOSE}`;
  });

  // 2) 스타일 없는 명령 버튼 → placeholder (Roll20 기본 버튼 모양)
  work = work.replace(COMMAND_LINK_RE, (_m, text, prefix) => {
    const i = placeholders.length;
    placeholders.push({ kind: 'styled', text, prefix, decls: [] });
    return `${PH_OPEN}${i}${PH_CLOSE}`;
  });

  // 3) 일반 마크다운 링크 → placeholder
  work = work.replace(NORMAL_LINK_RE, (_, text, url) => {
    if (/^javascript:/i.test(url)) return text;
    const i = placeholders.length;
    placeholders.push({ kind: 'normal', text, url });
    return `${PH_OPEN}${i}${PH_CLOSE}`;
  });

  // 4) 미처 들어가지 못한 이미지 URL → <img>
  work = work.replace(IMAGE_URL_RE, (_m, base, query) => {
    const full = base + (query || '');
    const url = /^https?:\/\//i.test(full) ? full : 'https://' + full;
    const i = placeholders.length;
    placeholders.push({ kind: 'image', url });
    return `${PH_OPEN}${i}${PH_CLOSE}`;
  });

  // 5) 백틱 인라인 코드(``text``) → placeholder
  work = work.replace(BACKTICK_RE, (_m, code) => {
    const i = placeholders.length;
    placeholders.push({ kind: 'code', code });
    return `${PH_OPEN}${i}${PH_CLOSE}`;
  });

  // 6) 겹치기 매크로 좌표가 엔진별 공백 처리에 흔들리지 않게 직접 접는다.
  work = collapseOutOfFlowGaps(work, placeholders);

  // 7) HTML escape + 마크다운 처리
  let html = escapeHtml(work);
  html = applyMarkdown(html);

  // 8) placeholder 복원
  const placeholderRe = new RegExp(
    escapeRegex(PH_OPEN) + '(\\d+)' + escapeRegex(PH_CLOSE),
    'g',
  );
  html = html.replace(placeholderRe, (_m, idx) => {
    const p = placeholders[+idx];
    switch (p.kind) {
      case 'styled': return renderStyledLink(p);
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

function renderStyledLink(p) {
  const styleStr = p.decls.map((d) => `${d.prop}: ${d.value}`).join('; ');

  // 링크 텍스트 안에서도 **굵게**, *기울임*, ~~취소~~ 마크다운 처리.
  const escapedText = applyMarkdown(escapeHtml(decodeEntities(p.text)));

  const prefix = decodeEntities(p.prefix || '').trim();
  const isExternal = /^https?:\/\//i.test(prefix);
  const href = isExternal ? prefix : '#';
  const onclick = isExternal ? '' : ' onclick="return false"';
  const target = isExternal ? ' target="_blank" rel="noopener noreferrer"' : '';

  // Roll20 는 !명령 / ~매크로 / 채팅명령 링크를 "버튼"으로 그린다.
  // 그 기본 스타일(inline-block + padding)이 없으면 width/height 가 아예
  // 안 먹고(<a> 는 기본이 inline), 버튼 옆에 절대위치로 겹쳐 놓는 도형들의
  // 좌표까지 전부 어긋난다 — 하트 편지봉투 매크로가 깨져 보이던 원인.
  const cls = COMMAND_PREFIX_RE.test(prefix) ? 'r20-styled r20-button' : 'r20-styled';

  return `<a class="${cls}" href="${escapeHtml(href)}"${target}${onclick} style="${escapeHtml(styleStr)}">${escapedText}</a>`;
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

function processInput(text) {
  const messages = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const cmd = detectCommand(line);
    messages.push({
      type: cmd.name,
      html: processInline(cmd.rest),
      speaker: cmd.speaker || '',
    });
  }
  return messages;
}

// ============================================================
// 7. 렌더링
// ============================================================

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

// 쿼리 패널. 매 입력마다 통째로 다시 그리면 자유 입력칸의 포커스/커서가
// 날아가므로, 쿼리 목록 자체가 바뀐 경우에만 다시 만든다.
function syncQueryPanel(queries) {
  const panel = $('#query-panel');
  const list = $('#query-list');
  const sig = queries.map((q) => q.key).join(' ');
  if (sig === state.queryKeys) return;
  state.queryKeys = sig;

  list.innerHTML = '';
  panel.hidden = queries.length === 0;
  if (!queries.length) return;

  queries.forEach((q, n) => {
    const row = document.createElement('div');
    row.className = 'query-row';

    const label = document.createElement('label');
    label.className = 'query-label';
    label.textContent = q.prompt;
    label.htmlFor = `query-field-${n}`;
    row.appendChild(label);

    let field;
    if (q.type === 'select') {
      field = document.createElement('select');
      q.options.forEach((opt, i) => {
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = opt.label;
        field.appendChild(o);
      });
      const saved = state.answers[q.key];
      field.value = String(Number.isInteger(saved) && q.options[saved] ? saved : 0);
      field.addEventListener('change', () => {
        state.answers[q.key] = Number(field.value);
        refreshPreview();
      });
    } else {
      field = document.createElement('input');
      field.type = 'text';
      field.placeholder = q.def || '자유 입력';
      const saved = state.answers[q.key];
      field.value = typeof saved === 'string' ? saved : q.def;
      field.addEventListener('input', () => {
        state.answers[q.key] = field.value;
        refreshPreview();
      });
    }
    field.id = `query-field-${n}`;
    field.className = 'query-field';
    row.appendChild(field);
    list.appendChild(row);
  });
}

// ============================================================
// 8. 영속화
// ============================================================

const STORAGE_KEY = 'roll20-chat-preview-v5';

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      input: $('#macro-input').value,
      darkChat: $('#chat-window').classList.contains('dark'),
      answers: state.answers,
    }));
  } catch (_) { /* 무시 */ }
}
function restore() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!data) return;
    if (data.input) $('#macro-input').value = normalizeQuotes(data.input);
    if (data.darkChat) $('#chat-window').classList.add('dark');
    if (data.answers && typeof data.answers === 'object') state.answers = data.answers;
  } catch (_) { /* 무시 */ }
}

// ============================================================
// 9. 부트
// ============================================================

// 쿼리 답만 바뀐 경우 — 패널은 그대로 두고 미리보기만 다시 그린다.
function refreshPreview() {
  const txt = $('#macro-input').value;
  state.messages = txt.trim() ? processInput(txt) : [];
  renderChat();
  persist();
}

function update() {
  syncQueryPanel(collectQueries($('#macro-input').value));
  refreshPreview();
}

async function copyMacro() {
  const el = $('#macro-input');
  const text = normalizeQuotes(el.value);
  if (text !== el.value) el.value = text; // 화면에도 깨끗한 버전 반영
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
  const input = $('#macro-input');
  input.addEventListener('input', () => {
    // OS 가 끼워넣은 스마트따옴표/NBSP 를 즉시 ASCII 로 되돌린다.
    // 1:1 치환이라 글자 길이는 그대로, 커서 위치만 유지하면 됨.
    const orig = input.value;
    const norm = normalizeQuotes(orig);
    if (orig !== norm) {
      const pos = input.selectionStart;
      input.value = norm;
      input.setSelectionRange(pos, pos);
    }
    debounced();
  });

  $('#copy-btn').addEventListener('click', copyMacro);
  $('#clear-input-btn').addEventListener('click', () => {
    if (!input.value) return;
    if (!window.confirm('입력한 매크로를 모두 지울까요?')) return;
    input.value = '';
    update();
    input.focus();
  });
  $('#chat-bg-toggle').addEventListener('click', () => {
    $('#chat-window').classList.toggle('dark');
    persist();
  });

  update();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', setup);
} else {
  setup();
}
