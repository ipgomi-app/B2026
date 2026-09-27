/* index.html + 스크립트(JSZip·ExcelJS·kit·engine)를 한 파일로 합친다.
 * 사용: node tools/build-single.js <출력.html>
 */
const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, '..');
const out = process.argv[2];
if (!out) { console.error('usage: node tools/build-single.js <out.html>'); process.exit(1); }
let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const code = fs.readFileSync(path.join(dir, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '<script>/* ' + path.basename(src) + ' */\n' + code + '\n</script>';
});
fs.writeFileSync(out, html);
console.log(out, (fs.statSync(out).size / 1024 / 1024).toFixed(2) + ' MB');
