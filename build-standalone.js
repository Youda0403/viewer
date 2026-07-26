#!/usr/bin/env node
/**
 * 1) index.html 이 참조하는 styles.css / app.js 에 내용 해시를 박아
 *    캐시 무효화한다 (styles.css?v=ab12cd34).
 * 2) 3개 파일을 단일 HTML (roll20-tester.html) 로 합친다.
 *
 * 사용: node build-standalone.js
 *
 * (1)이 필요한 이유: GitHub Pages 는 정적 파일에 max-age 를 걸어서 내보낸다.
 * index.html 은 비교적 빨리 갱신되는데 app.js / styles.css 는 브라우저
 * 캐시에 눌러앉아, "새 HTML + 옛날 JS" 라는 최악의 조합이 만들어진다.
 * 화면 절반만 업데이트된 것처럼 보이고 원인 찾기도 어렵다. 파일 내용이
 * 바뀌면 URL 도 바뀌게 해서 이 상황 자체를 없앤다.
 *
 * 주의: String.prototype.replace 는 치환 문자열의 $$ 를 $ 로 바꾸기 때문에
 * 코드에 $$ 식별자가 있으면 깨진다. 그래서 split/join 방식을 쓴다.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const indexPath = path.join(root, 'index.html');

const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const js  = fs.readFileSync(path.join(root, 'app.js'),     'utf8');

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);

// 1) 캐시 무효화 스탬프
let html = fs.readFileSync(indexPath, 'utf8');
const before = html;
html = html
  .replace(/href="styles\.css(?:\?[^"]*)?"/, `href="styles.css?v=${hash(css)}"`)
  .replace(/src="app\.js(?:\?[^"]*)?"/,      `src="app.js?v=${hash(js)}"`);
if (html !== before) {
  fs.writeFileSync(indexPath, html);
  console.log('stamped index.html  styles.css?v=' + hash(css) + '  app.js?v=' + hash(js));
}

// 2) 단일 파일 빌드 — 인라인이라 ?v= 쿼리는 떼고 넣는다.
const linkTag = html.match(/<link rel="stylesheet" href="styles\.css[^"]*" \/>/)[0];
const scriptTag = html.match(/<script src="app\.js[^"]*"><\/script>/)[0];

const out = html
  .split(linkTag).join('<style>\n' + css + '\n  </style>')
  .split(scriptTag).join('<script>\n' + js + '\n  </script>');

const dest = path.join(root, 'roll20-tester.html');
fs.writeFileSync(dest, out);
console.log('built', dest, '(' + out.length + ' bytes)');
