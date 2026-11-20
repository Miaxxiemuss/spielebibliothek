// Build- und Installationsskript für die Spielebibliothek
//
//   node build.js --installieren   Programm nach %APPDATA%\Spielebibliothek\programm kopieren und
//                                  Verknüpfungen (Desktop + Startmenü) mit eigenem Icon anlegen.
//                                  Gestartet wird über das signierte node.exe (kein Konsolenfenster).
//   node build.js --exe            Zusätzlich eine eigenständige Spielebibliothek.exe bauen
//                                  (Node.js Single Executable Application, benötigt "postject").
//
// Ohne Parameter wird nur build/bundle.js + build/Spielebibliothek.ico erzeugt.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');
const BUILD = path.join(ROOT, 'build');
const EXE_NAME = 'Spielebibliothek.exe';
const ARGS = process.argv.slice(2);
fs.mkdirSync(BUILD, { recursive: true });

// 1) Oberfläche in den Code einbetten -> eine einzige Datei
const ui = fs.readFileSync(path.join(SRC, 'ui.html'), 'utf8');
let code = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
if (!code.includes('/*__UI__*/null')) throw new Error('Platzhalter für die Oberfläche fehlt in src/app.js');
code = code.replace('/*__UI__*/null', () => JSON.stringify(ui));
fs.writeFileSync(path.join(BUILD, 'bundle.js'), code);
console.log('✓ build/bundle.js');

// 2) Icon erzeugen
fs.writeFileSync(path.join(BUILD, 'Spielebibliothek.ico'), makeIco([16, 24, 32, 48, 64, 128, 256]));
console.log('✓ build/Spielebibliothek.ico');

(async () => {
  if (ARGS.includes('--exe')) await buildExe();
  if (ARGS.includes('--installieren')) install();
  if (!ARGS.includes('--exe') && !ARGS.includes('--installieren')) console.log('Tipp: "npm run installieren" legt Verknüpfungen an, "npm run exe" baut eine exe.');
})().catch(e => { console.error(e); process.exit(1); });

async function buildExe() {
  const seaCfg = path.join(BUILD, 'sea-config.json');
  fs.writeFileSync(seaCfg, JSON.stringify({ main: path.join(BUILD, 'bundle.js'), output: path.join(BUILD, 'sea-prep.blob'), disableExperimentalSEAWarning: true, useCodeCache: false }));
  execFileSync(process.execPath, ['--experimental-sea-config', seaCfg], { stdio: 'inherit' });
  const exe = path.join(BUILD, EXE_NAME);
  fs.copyFileSync(process.execPath, exe);
  let inject;
  try { ({ inject } = require('postject')); } catch { throw new Error('Für --exe bitte zuerst "npm install" ausführen (benötigt postject).'); }
  await inject(exe, 'NODE_SEA_BLOB', fs.readFileSync(path.join(BUILD, 'sea-prep.blob')), { sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2' });
  // Als Windows-GUI-Programm markieren (kein Konsolenfenster)
  const buf = fs.readFileSync(exe);
  const pe = buf.readUInt32LE(0x3c);
  if (buf.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('Kein PE-Header gefunden');
  buf.writeUInt16LE(2, pe + 24 + 68); // IMAGE_SUBSYSTEM_WINDOWS_GUI
  fs.writeFileSync(exe, buf);
  console.log(`✓ ${exe} (${(fs.statSync(exe).size / 1048576).toFixed(0)} MB)`);
  console.log('  Hinweis: Die exe ist nicht signiert. Die Windows-„Intelligente App-Steuerung“ kann sie blockieren –');
  console.log('  in dem Fall die Variante "npm run installieren" verwenden.');
}

function install() {
  if (process.platform !== 'win32') throw new Error('Die Installation mit Verknüpfungen ist nur unter Windows möglich.');
  const prog = path.join(process.env.APPDATA, 'Spielebibliothek', 'programm');
  fs.mkdirSync(prog, { recursive: true });
  const script = path.join(prog, 'spielebibliothek.js');
  const ico = path.join(prog, 'Spielebibliothek.ico');
  fs.copyFileSync(path.join(BUILD, 'bundle.js'), script);
  fs.copyFileSync(path.join(BUILD, 'Spielebibliothek.ico'), ico);
  // conhost --headless startet node.exe ohne sichtbares Konsolenfenster
  const conhost = path.join(process.env.SystemRoot, 'System32', 'conhost.exe');
  const q = s => s.replace(/'/g, "''");
  const args = `--headless "${process.execPath}" "${script}"`;
  const targets = [
    `'${q(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Spielebibliothek.lnk'))}'`,
    `(Join-Path ([Environment]::GetFolderPath('Desktop')) 'Spielebibliothek.lnk')`,
  ];
  const ps = `$w = New-Object -ComObject WScript.Shell; ` + targets.map(t =>
    `$s = $w.CreateShortcut(${t}); $s.TargetPath = '${q(conhost)}'; $s.Arguments = '${q(args)}'; $s.IconLocation = '${q(ico)},0'; $s.WorkingDirectory = '${q(prog)}'; $s.Description = 'Spielebibliothek'; $s.WindowStyle = 7; $s.Save();`).join(' ');
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
  console.log(`✓ Installiert nach ${prog}`);
  console.log('✓ Verknüpfungen auf dem Desktop und im Startmenü angelegt');
}

// ---------------------------------------------------------------------------
// Icon: Controller auf Farbverlauf, per Signed-Distance-Funktionen gezeichnet
// ---------------------------------------------------------------------------
function makeIco(sizes) {
  const pngs = sizes.map(s => ({ s, png: png(s, s, renderIcon(s)) }));
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let off = head.length;
  pngs.forEach(({ s, png: p }, i) => {
    const o = 6 + i * 16;
    head.writeUInt8(s >= 256 ? 0 : s, o); head.writeUInt8(s >= 256 ? 0 : s, o + 1);
    head.writeUInt16LE(1, o + 4); head.writeUInt16LE(32, o + 6);
    head.writeUInt32LE(p.length, o + 8); head.writeUInt32LE(off, o + 12);
    off += p.length;
  });
  return Buffer.concat([head, ...pngs.map(p => p.png)]);
}

function renderIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const k = 256 / size;
  const clamp = v => Math.max(0, Math.min(1, v));
  const len = (x, y) => Math.hypot(x, y);
  const roundBox = (x, y, cx, cy, bx, by, r) => {
    const qx = Math.abs(x - cx) - bx + r, qy = Math.abs(y - cy) - by + r;
    return len(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  const capsule = (x, y, ax, ay, bx, by, r) => {
    const pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay;
    const h = clamp((pax * bax + pay * bay) / (bax * bax + bay * bay));
    return len(pax - bax * h, pay - bay * h) - r;
  };
  const circle = (x, y, cx, cy, r) => len(x - cx, y - cy) - r;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const x = (i + 0.5) * k, y = (j + 0.5) * k;
    const aa = d => clamp(0.5 - d / k);
    const bg = aa(roundBox(x, y, 128, 128, 120, 120, 56));
    const body = Math.min(roundBox(x, y, 128, 118, 86, 44, 40), capsule(x, y, 72, 128, 58, 182, 30), capsule(x, y, 184, 128, 198, 182, 30));
    const cut = Math.min(roundBox(x, y, 88, 116, 22, 7, 2.5), roundBox(x, y, 88, 116, 7, 22, 2.5), circle(x, y, 166, 104, 9.5), circle(x, y, 188, 126, 9.5));
    const fg = aa(body) * (1 - aa(cut));
    const t = clamp((x + y) / 512);
    const r = 124 + (163 - 124) * t, g = 140 + (92 - 140) * t, b = 255;
    const o = (j * size + i) * 4;
    px[o] = Math.round(r + (255 - r) * fg); px[o + 1] = Math.round(g + (255 - g) * fg); px[o + 2] = Math.round(b + (255 - b) * fg);
    px[o + 3] = Math.round(255 * bg);
  }
  return px;
}

function png(w, h, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const v of b) c = crcTable[(c ^ v) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => {
    const l = Buffer.alloc(4); l.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([l, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
