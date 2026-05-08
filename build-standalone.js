#!/usr/bin/env node
/**
 * 3개 파일 (index.html / styles.css / app.js) 을 단일 HTML 파일로 합친다.
 * 사용: node build-standalone.js
 *
 * 주의: String.prototype.replace 는 치환 문자열의 $$ 를 $ 로 바꾸기 때문에
 * 코드에 $$ 식별자가 있으면 깨진다. 그래서 split/join 방식을 쓴다.
 */

const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css  = fs.readFileSync(path.join(root, 'styles.css'),  'utf8');
const js   = fs.readFileSync(path.join(root, 'app.js'),       'utf8');

const out = html
  .split('<link rel="stylesheet" href="styles.css" />').join('<style>\n' + css + '\n  </style>')
  .split('<script src="app.js"></script>').join('<script>\n' + js + '\n  </script>');

const dest = path.join(root, 'roll20-tester.html');
fs.writeFileSync(dest, out);
console.log('built', dest, '(' + out.length + ' bytes)');
