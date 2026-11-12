'use strict';
// Склеивает engine.js и server.js в один файл и пишет настройки сборки для `node --build-sea`.
// Запуск: node bundle.js <папка для результатов>
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..');
const out = path.resolve(process.argv[2]);
fs.mkdirSync(out, { recursive: true });

const engine = fs.readFileSync(path.join(src, 'engine.js'), 'utf8');
let server = fs.readFileSync(path.join(src, 'server.js'), 'utf8');
const marker = "require('./engine')";
if (!server.includes(marker)) throw new Error('В server.js не найдено подключение движка');
server = server.replace(marker, '__engine');

const main = [
  "'use strict';",
  'const __engine = (function () { const module = { exports: {} }; (function (module, exports) {',
  engine,
  '})(module, module.exports); return module.exports; })();',
  server,
].join('\n');
fs.writeFileSync(path.join(out, 'main.js'), main);

const assets = {};
// Ключ ресурса — путь относительно public с прямыми слэшами, как в адресе страницы.
(function walk(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) walk(path.join(dir, entry.name), prefix + entry.name + '/');
    else assets[prefix + entry.name] = path.join(dir, entry.name);
  }
})(path.join(src, 'public'), '');
fs.writeFileSync(path.join(out, 'sea-config.json'), JSON.stringify({
  main: path.join(out, 'main.js'),
  output: path.join(out, 'poker-server.exe'),
  disableExperimentalSEAWarning: true,
  assets,
}, null, 2));
console.log('bundle ok: ' + Object.keys(assets).length + ' files');
