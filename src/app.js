// Spielebibliothek – Desktop-App für Windows
// Lokaler Server (nur 127.0.0.1) + Oberfläche im App-Fenster (Edge/Chrome/Brave im --app-Modus).
// Listet Spiele aus Steam, Epic Games, GOG, itch.io und weiteren Launchern auf, schätzt pro Gerät
// Spielbarkeit/FPS, zeigt Angebote, Favoriten, Zufallsvorschläge und lädt GOG-Spiele direkt herunter.
//
// Alle Daten (Einstellungen, Tokens, Cache) liegen ausschließlich lokal unter %APPDATA%\Spielebibliothek.
// Lizenz: MIT – siehe LICENSE. Kein offizielles Produkt von Valve, Epic Games, GOG oder anderen Anbietern.
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const crypto = require('crypto');
const { execSync, spawn } = require('child_process');

const IS_SEA = (() => { try { return require('node:sea').isSea(); } catch { return false; } })();
const APP_DIR = IS_SEA ? path.dirname(process.execPath) : __dirname;
const DATA_DIR = path.join(process.env.APPDATA || path.join(os.homedir(), '.config'), 'Spielebibliothek');
fs.mkdirSync(DATA_DIR, { recursive: true });
const F = n => path.join(DATA_DIR, n);
const CONFIG_FILE = F('einstellungen.json');
const CACHE_FILE = F('cache.json');
const ACC_FILE = F('konten.json');
const LIB_FILE = F('bibliothek.json');
const LOG_FILE = F('log.txt');
const LOCK_FILE = F('laeuft.json');
const UA = { 'User-Agent': 'SpieleBibliothek/2.0 (lokales Tool)' };
const ARGS = process.argv.slice(2);
const argVal = k => { const a = ARGS.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=').slice(1).join('=') : null; };
const NO_WINDOW = ARGS.includes('--kein-fenster');

process.removeAllListeners('warning');

// ---------------------------------------------------------------------------
// Protokoll + Live-Ereignisse an die Oberfläche
// ---------------------------------------------------------------------------
const clients = new Set();
function broadcast(ev) {
  const s = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) { try { c.write(s); } catch {} }
}
try { if (fs.statSync(LOG_FILE).size > 1e6) fs.unlinkSync(LOG_FILE); } catch {}
function log(...a) {
  const s = a.join(' ');
  try { fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${s}\n`); } catch {}
  if (!IS_SEA) console.log(s);
  broadcast({ type: 'log', text: s });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// GPU-Leistungstabelle (ungefähre 3DMark-Time-Spy-Grafikpunkte)
// ---------------------------------------------------------------------------
const GPU = {
  'rtx 5090': 48000, 'rtx 5080': 32500, 'rtx 5070 ti': 28500, 'rtx 5070': 22500, 'rtx 5060 ti': 16000, 'rtx 5060': 13500, 'rtx 5050': 10500,
  'rtx 4090': 36000, 'rtx 4080 super': 28500, 'rtx 4080': 28000, 'rtx 4070 ti super': 24000, 'rtx 4070 ti': 22500, 'rtx 4070 super': 21000, 'rtx 4070': 17800,
  'rtx 4060 ti': 13500, 'rtx 4060': 10600, 'rtx 4050': 8500,
  'rtx 3090 ti': 21500, 'rtx 3090': 19500, 'rtx 3080 ti': 19000, 'rtx 3080': 17500, 'rtx 3070 ti': 14500, 'rtx 3070': 13500,
  'rtx 3060 ti': 11700, 'rtx 3060': 8700, 'rtx 3050 ti': 5500, 'rtx 3050': 6200,
  'rtx 2080 ti': 14500, 'rtx 2080 super': 11700, 'rtx 2080': 11000, 'rtx 2070 super': 10000, 'rtx 2070': 9000, 'rtx 2060 super': 8700, 'rtx 2060': 7500,
  'titan rtx': 14500, 'titan xp': 9800, 'titan x': 7000,
  'gtx 1660 ti': 6300, 'gtx 1660 super': 6100, 'gtx 1660': 5500, 'gtx 1650 super': 4800, 'gtx 1650': 3600, 'gtx 1630': 2100,
  'gtx 1080 ti': 9500, 'gtx 1080': 7500, 'gtx 1070 ti': 6800, 'gtx 1070': 6000, 'gtx 1060': 4100, 'gtx 1050 ti': 2500, 'gtx 1050': 1900, 'gt 1030': 1100,
  'gtx 980 ti': 5500, 'gtx 980': 4200, 'gtx 970': 3600, 'gtx 960': 2300, 'gtx 950': 1800,
  'gtx titan': 2900, 'gtx 780 ti': 3500, 'gtx 780': 3000, 'gtx 770': 2300, 'gtx 760': 1850, 'gtx 750 ti': 1300, 'gtx 750': 1100,
  'gtx 690': 3000, 'gtx 680': 2100, 'gtx 670': 1900, 'gtx 660 ti': 1600, 'gtx 660': 1400, 'gtx 650 ti boost': 1150, 'gtx 650 ti': 900, 'gtx 650': 650,
  'gtx 590': 1700, 'gtx 580': 1350, 'gtx 570': 1150, 'gtx 560 ti': 950, 'gtx 560': 800, 'gtx 550 ti': 550,
  'gtx 480': 1100, 'gtx 470': 900, 'gtx 460': 650, 'gts 450': 520, 'gtx 285': 620, 'gtx 280': 580, 'gtx 275': 560, 'gtx 260': 480,
  'gts 250': 430, '9800 gt': 360, '9800 gtx': 420, '8800 gt': 350, '8800 gtx': 380, '8800 ultra': 400, '8800 gts': 300, '9600 gt': 250, '9500 gt': 120, '8600 gt': 90, '8500 gt': 50, '8400 gs': 30,
  'gt 730': 300, 'gt 740': 450, 'gt 710': 120, 'gt 640': 400, 'gt 630': 250, 'gt 610': 100, 'gt 520': 100, 'gt 440': 220, 'gt 430': 150, 'gt 240': 230, 'gt 220': 120,
  '7950 gt': 170, '7900 gtx': 180, '7900 gt': 150, '7800 gtx': 150, '7800 gt': 130, '7600 gt': 90, '6800 gt': 60, '6600 gt': 40,
  '9800': 380, '8800': 330, '7900': 160, '7800': 140, '7600': 90, '6800': 60, '6600': 40,
  'x1950': 200, 'x1900': 180, 'x1800': 140, 'x1650': 80, 'x1600': 70, 'x850': 55, 'x800': 50,
  'hd 2900': 260, 'hd 3650': 100, 'hd 4670': 220, 'hd 4650': 160, 'hd 5570': 220, 'hd 5450': 70, 'hd 6570': 250,
  'rx 9070 xt': 30000, 'rx 9070': 26500, 'rx 9060 xt': 16000, 'rx 9060': 13000,
  'rx 7900 xtx': 30000, 'rx 7900 xt': 26500, 'rx 7900 gre': 22000, 'rx 7800 xt': 19500, 'rx 7700 xt': 16800, 'rx 7600 xt': 11000, 'rx 7600': 10800,
  'rx 6950 xt': 21500, 'rx 6900 xt': 20500, 'rx 6800 xt': 19000, 'rx 6800': 16000, 'rx 6750 xt': 13000, 'rx 6700 xt': 12500, 'rx 6700': 11000,
  'rx 6650 xt': 10000, 'rx 6600 xt': 9500, 'rx 6600': 8000, 'rx 6500 xt': 5000, 'rx 6400': 4000,
  'rx 5700 xt': 9000, 'rx 5700': 8200, 'rx 5600 xt': 7500, 'rx 5500 xt': 5000, 'radeon vii': 8700, 'vega 64': 7300, 'vega 56': 6500,
  'rx 590': 4500, 'rx 580': 4300, 'rx 570': 3800, 'rx 480': 4100, 'rx 470': 3600, 'rx 560': 2000, 'rx 460': 1800, 'rx 550': 1300,
  'r9 fury x': 5300, 'r9 fury': 5000, 'r9 nano': 4700, 'r9 390x': 4300, 'r9 390': 4000, 'r9 380x': 3300, 'r9 380': 3000, 'r9 290x': 3600, 'r9 290': 3400,
  'r9 285': 2800, 'r9 280x': 2700, 'r9 280': 2400, 'r9 270x': 2100, 'r9 270': 1900, 'r7 370': 1800, 'r7 265': 1700, 'r7 260x': 1400, 'r7 360': 1300, 'r7 250': 700,
  'hd 7990': 4500, 'hd 7970': 2700, 'hd 7950': 2300, 'hd 7870': 1900, 'hd 7850': 1600, 'hd 7790': 1300, 'hd 7770': 1000, 'hd 7750': 750,
  'hd 6990': 2500, 'hd 6970': 1500, 'hd 6950': 1350, 'hd 6870': 1150, 'hd 6850': 1000, 'hd 6790': 850, 'hd 6770': 650, 'hd 6750': 550, 'hd 6670': 400,
  'hd 5970': 2000, 'hd 5870': 1100, 'hd 5850': 950, 'hd 5830': 800, 'hd 5770': 600, 'hd 5750': 500, 'hd 5670': 300,
  'hd 4890': 550, 'hd 4870': 480, 'hd 4850': 420, 'hd 4770': 380, 'hd 3870': 280, 'hd 3850': 240, 'hd 2600': 70,
  'arc b580': 14500, 'arc b570': 12500, 'arc a770': 13500, 'arc a750': 12500, 'arc a580': 10500, 'arc a380': 4500, 'arc 140v': 4200, 'arc 130v': 3500,
  'arc igpu': 3500, 'iris xe': 1500, 'iris plus': 800, 'iris pro': 700, 'uhd 770': 650, 'uhd 750': 600, 'uhd 730': 500, 'uhd 630': 450, 'uhd 620': 400, 'uhd 600': 200,
  'hd 630': 450, 'hd 620': 400, 'hd 530': 400, 'hd 520': 350, 'hd 4600': 300, 'hd 4400': 250, 'hd 4000': 150, 'hd 3000': 70,
  'radeon 890m': 3900, 'radeon 880m': 3300, 'radeon 780m': 2800, 'radeon 760m': 2300, 'radeon 740m': 1500, 'radeon 680m': 2400, 'radeon 660m': 1700,
  'vega 11': 1300, 'vega 8': 1100, 'vega 7': 1100, 'vega 6': 900, 'vega 3': 500,
  'steam deck': 1300, 'rog ally': 2800, 'legion go': 2800, 'z1 extreme': 2800, 'z2 extreme': 3800,
};
const GPU_KEYS = Object.keys(GPU).sort((a, b) => b.length - a.length);
const UPPER = new Set(['rtx', 'gtx', 'gts', 'gt', 'rx', 'hd', 'uhd', 'r9', 'r7', 'xt', 'xtx', 'gre', 'vii', 'rog', 'xe']);
const prettyGpu = k => k.split(' ').map(w => UPPER.has(w) ? w.toUpperCase() : w === 'ti' ? 'Ti' : w === 'igpu' ? 'Graphics' : w[0].toUpperCase() + w.slice(1)).join(' ');

function normGpu(s) {
  return (' ' + String(s).toLowerCase()
    .replace(/<[^>]+>/g, ' ')
    .replace(/\(r\)|\(tm\)|™|®/g, ' ')
    .replace(/arc\s+graphics/g, 'arc igpu')
    .replace(/geforce\s+(\d{3})(?!\d)/g, 'gtx $1')
    .replace(/\b(geforce|nvidia|amd|ati|intel|graphics)\b/g, ' ')
    .replace(/(rtx|gtx|gts|gt|rx|r9|r7|hd|uhd|arc)\s*-?\s*(\d)/g, '$1 $2')
    .replace(/(\d)\s*(ti|xt|xtx|gre)\b/g, '$1 $2')
    .replace(/\s+/g, ' ') + ' ');
}

function findGpus(text) {
  let t = normGpu(text);
  const found = [];
  for (const k of GPU_KEYS) {
    const re = new RegExp('(^|[^a-z0-9])' + k.replace(/ /g, '\\s?') + '(?![0-9])', 'i');
    const m = t.match(re);
    if (m) { found.push({ name: k, score: GPU[k] }); t = t.replace(re, ' '); }
  }
  if (!found.length && /radeon(tm)? graphics/i.test(text)) found.push({ name: 'radeon graphics (apu)', score: 1300 });
  return found;
}

function gpuScoreOfDevice(name) {
  const f = findGpus(name || '');
  if (!f.length) return null;
  let s = Math.max(...f.map(x => x.score));
  if (/laptop|mobile|max-q|notebook/i.test(name)) s *= 0.8;
  return Math.round(s);
}

// ---------------------------------------------------------------------------
// Anforderungen aus Steam-HTML lesen
// ---------------------------------------------------------------------------
function stripHtml(s) {
  return String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/li>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();
}

function parseReq(html) {
  if (!html || typeof html !== 'string') return null;
  const txt = stripHtml(html);
  const line = re => (txt.split('\n').find(l => re.test(l)) || '');
  const gfx = line(/^(grafik|graphics|video|grafikkarte|gpu)\s*:/i).replace(/^[^:]+:\s*/, '');
  const cpu = line(/^(prozessor|processor|cpu)\s*:/i).replace(/^[^:]+:\s*/, '');
  const ramLine = line(/^(arbeitsspeicher|memory|ram|speicher)\s*:/i);
  let ram = null;
  const mg = ramLine.match(/(\d+(?:[.,]\d+)?)\s*(gb|mb)/i);
  if (mg) ram = parseFloat(mg[1].replace(',', '.')) / (mg[2].toLowerCase() === 'mb' ? 1024 : 1);
  const dxm = line(/^directx\s*:/i).match(/(\d+)/);
  const dx = dxm ? +dxm[1] : null;
  const dm = line(/^(speicherplatz|storage|hard drive|festplatte|hard disk space)\s*:/i).match(/(\d+(?:[.,]\d+)?)\s*(gb|mb|tb)/i);
  const disk = dm ? +(parseFloat(dm[1].replace(',', '.')) * ({ mb: 1 / 1024, gb: 1, tb: 1024 })[dm[2].toLowerCase()]).toFixed(1) : null;
  return { text: gfx || null, dx, cpu: cpu || null, ram, disk, ...gfxScore(gfx || txt, gfx ? null : dx, !!gfx) };
}

// Bewertet die Grafik-Angabe (gemerkt, damit Tabellen-Updates auch für gespeicherte Spiele greifen)
const gfxMemo = new Map();
function gfxScore(gfx, dx, isGfxLine = true) {
  const k = `${gfx}|${dx}|${isGfxLine}`;
  if (gfxMemo.has(k)) return gfxMemo.get(k);
  let score = null, how = '';
  const gpus = findGpus(gfx);
  if (gpus.length) {
    score = Math.round(gpus.reduce((a, g) => a + g.score, 0) / gpus.length);
    how = gpus.map(g => prettyGpu(g.name)).join(' / ');
  } else if (gfx && isGfxLine) {
    const v = gfx.match(/(\d+(?:[.,]\d+)?)\s*(gb|mb)/i);
    if (v) {
      const gb = parseFloat(v[1].replace(',', '.')) / (v[2].toLowerCase() === 'mb' ? 1024 : 1);
      score = gb >= 8 ? 9000 : gb >= 6 ? 6000 : gb >= 4 ? 4000 : gb >= 3 ? 3000 : gb >= 2 ? 1800 : gb >= 1 ? 700 : gb >= 0.5 ? 300 : 150;
      how = `${gb} GB VRAM`;
    } else if (/directx\s*(9|8)|opengl\s*[12]|integrated|integriert|onboard|shader model\s*[23]/i.test(gfx)) {
      score = 150; how = 'einfache Grafik';
    } else if (/directx\s*1[01]|opengl\s*[34]/i.test(gfx)) {
      score = 400; how = 'DirectX 10/11-Karte';
    } else if (/directx\s*12|vulkan/i.test(gfx)) {
      score = 1500; how = 'DirectX 12/Vulkan-Karte';
    }
  } else if (dx) {
    score = dx >= 12 ? 1500 : dx >= 10 ? 500 : 150; how = `nur DirectX ${dx}-Angabe`;
  }
  const r = { score, how };
  gfxMemo.set(k, r);
  return r;
}
// Neu bewerten, wenn der Grafiktext gespeichert ist (ältere Cache-Einträge behalten ihren Wert)
const rescoreReq = r => (r && r.text) ? { ...r, ...gfxScore(r.text, null, true) } : r;

// ---------------------------------------------------------------------------
// Konfiguration, Cache, Konten
// ---------------------------------------------------------------------------
const DEFAULT_CONFIG = {
  geraete: [
    { name: 'Dieser PC', auto: true, aufloesung: '1080p', max_fps: 60, os: 'windows' },
    { name: 'Steam Deck', gpu: 'Steam Deck', ram_gb: 16, aufloesung: '800p', max_fps: 60, os: 'linux', steam_deck: true },
  ],
  manuelle_spiele: [],
};
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '')); } catch { return d; } };
const writeJson = (f, v, pretty) => fs.writeFileSync(f, JSON.stringify(v, null, pretty ? 2 : 0), 'utf8');
function loadConfig() {
  const c = readJson(CONFIG_FILE, null);
  if (!c) { writeJson(CONFIG_FILE, DEFAULT_CONFIG, true); return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
  if (!Array.isArray(c.geraete)) c.geraete = DEFAULT_CONFIG.geraete;
  return c;
}
const saveConfig = c => writeJson(CONFIG_FILE, c, true);
const loadCache = () => readJson(CACHE_FILE, {});
const saveCache = c => writeJson(CACHE_FILE, c);
const loadAccounts = () => readJson(ACC_FILE, {});
const saveAccounts = a => writeJson(ACC_FILE, a, true);
let library = readJson(LIB_FILE, { games: [], scannedAt: null });

// ---------------------------------------------------------------------------
// System-Hilfen (immer ohne sichtbares Konsolenfenster)
// ---------------------------------------------------------------------------
const run = (cmd, opts = {}) => execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, ...opts });
function ps(cmd) { try { return run(`powershell -NoProfile -Command "${cmd}"`).trim(); } catch { return ''; } }
function regQuery(key, value) {
  try {
    const out = run(`reg query "${key}" /v ${value}`);
    const m = out.match(new RegExp(value + '\\s+REG_\\w+\\s+(.+)'));
    return m ? m[1].trim() : null;
  } catch { return null; }
}
function regDefault(key) {
  try { const m = run(`reg query "${key}" /ve`).match(/REG_(?:EXPAND_)?SZ\s+(.+)/); return m ? m[1].trim().replace(/"/g, '') : null; } catch { return null; }
}
function openExternal(u) {
  if (process.platform === 'win32') spawn('rundll32.exe', ['url.dll,FileProtocolHandler', u], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn('xdg-open', [u], { detached: true, stdio: 'ignore' }).unref();
}
function findAppBrowser() {
  const c = [];
  for (const exe of ['msedge.exe', 'chrome.exe', 'brave.exe', 'vivaldi.exe']) {
    for (const h of ['HKCU', 'HKLM']) { const p = regDefault(`${h}\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${exe}`); if (p) c.push(p); }
  }
  for (const b of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, process.env.LOCALAPPDATA].filter(Boolean)) {
    c.push(path.join(b, 'Microsoft/Edge/Application/msedge.exe'), path.join(b, 'Google/Chrome/Application/chrome.exe'), path.join(b, 'BraveSoftware/Brave-Browser/Application/brave.exe'), path.join(b, 'Vivaldi/Application/vivaldi.exe'));
  }
  return c.find(p => { try { return fs.existsSync(p); } catch { return false; } });
}
function openWindow(url) {
  const b = findAppBrowser();
  if (!b) { log('Kein Chromium-Browser gefunden – öffne im Standardbrowser.'); return openExternal(url); }
  spawn(b, [`--app=${url}`, `--user-data-dir=${F('fenster')}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,920', '--disable-features=Translate'], { detached: true, stdio: 'ignore' }).unref();
}

// ---------------------------------------------------------------------------
// Hardware dieses PCs
// ---------------------------------------------------------------------------
let pcInfo = null;
function detectThisPc() {
  if (pcInfo) return pcInfo;
  let gpus = [], cpu = '';
  const ram = Math.round(os.totalmem() / 1024 ** 3);
  if (process.platform === 'win32') {
    gpus = ps('Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name }').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    cpu = ps('(Get-CimInstance Win32_Processor | Select-Object -First 1).Name');
  } else {
    try { gpus = run('lspci | grep -iE "vga|3d"').split('\n').filter(Boolean); } catch {}
    cpu = (os.cpus()[0] || {}).model || '';
  }
  gpus = gpus.filter(g => !/basic|virtual|parsec|remote|meta|idd|displaylink/i.test(g));
  let best = null;
  for (const g of gpus) { const s = gpuScoreOfDevice(g); if (s && (!best || s > best.score)) best = { name: g, score: s }; }
  pcInfo = { gpu: best ? best.name : (gpus[0] || 'unbekannt'), score: best ? best.score : null, cpu, ram };
  return pcInfo;
}

function resolveDevices(cfg) {
  return (cfg.geraete || []).map(d => {
    const dev = { ...d };
    if (d.auto) {
      const pc = detectThisPc();
      dev.gpu = d.gpu || pc.gpu; dev.ram_gb = d.ram_gb || pc.ram; dev.cpu = pc.cpu;
      dev.score = d.gpu ? gpuScoreOfDevice(d.gpu) : pc.score;
    } else dev.score = gpuScoreOfDevice(d.gpu || d.name);
    return dev;
  });
}

// ---------------------------------------------------------------------------
// Bibliotheken einlesen
// ---------------------------------------------------------------------------
function findSteamRoot() {
  const c = [];
  if (process.platform === 'win32') {
    c.push(regQuery('HKCU\\Software\\Valve\\Steam', 'SteamPath'), regQuery('HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'), 'C:/Program Files (x86)/Steam');
  } else c.push(path.join(os.homedir(), '.steam/steam'), path.join(os.homedir(), '.local/share/Steam'));
  return c.filter(Boolean).find(p => fs.existsSync(path.join(p, 'steamapps')));
}

const NOT_GAMES = /redistributable|steamworks common|proton|steam linux runtime|soundtrack|dedicated server|sdk\b|godot engine|blender|wallpaper engine|rpg maker|game maker|gamemaker|unreal engine|benchmark|demo$/i;

function scanSteam() {
  const root = findSteamRoot();
  if (!root) return [];
  const libs = new Map();
  const addLib = p => { const r = path.resolve(p); libs.set(r.toLowerCase(), r); };
  addLib(path.join(root, 'steamapps'));
  try {
    const vdf = fs.readFileSync(path.join(root, 'steamapps/libraryfolders.vdf'), 'utf8');
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) addLib(path.join(m[1].replace(/\\\\/g, '\\'), 'steamapps'));
  } catch {}
  const games = [];
  for (const lib of libs.values()) {
    let files = [];
    try { files = fs.readdirSync(lib).filter(f => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const f of files) {
      const t = fs.readFileSync(path.join(lib, f), 'utf8');
      const id = (t.match(/"appid"\s+"(\d+)"/) || [])[1];
      const name = (t.match(/"name"\s+"([^"]+)"/) || [])[1];
      const size = +((t.match(/"SizeOnDisk"\s+"(\d+)"/) || [])[1] || 0);
      if (!id || !name || NOT_GAMES.test(name) || games.some(g => g.steamId === +id)) continue;
      games.push({ store: 'Steam', name, steamId: +id, ownId: +id, installed: true, sizeGb: size ? +(size / 1024 ** 3).toFixed(1) : null });
    }
  }
  return games;
}

function localSteamUser() {
  const root = findSteamRoot();
  if (!root) return null;
  try {
    const v = fs.readFileSync(path.join(root, 'config/loginusers.vdf'), 'utf8');
    let best = null;
    for (const m of v.matchAll(/"(7656\d{13})"\s*\{([^}]*)\}/g)) {
      const ts = +((m[2].match(/"timestamp"\s+"(\d+)"/) || [])[1] || 0);
      const recent = /"MostRecent"\s+"1"/.test(m[2]);
      const name = (m[2].match(/"PersonaName"\s+"([^"]*)"/) || [])[1];
      if (!best || recent || ts > best.ts) best = { id: m[1], name, ts };
      if (recent) break;
    }
    return best;
  } catch { return null; }
}

async function scanSteamOwned(acc) {
  const api_key = acc.steam && acc.steam.api_key;
  const steam_id = (acc.steam && acc.steam.steam_id) || (localSteamUser() || {}).id;
  if (!api_key || !steam_id) return [];
  const u = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${encodeURIComponent(api_key)}&steamid=${encodeURIComponent(steam_id)}&include_appinfo=1&include_played_free_games=1`;
  const res = await fetch(u, { headers: UA });
  if (res.status === 401 || res.status === 403) throw new Error('Steam-API-Schlüssel ungültig');
  const r = await res.json();
  if (!r.response || !r.response.games) throw new Error('Steam liefert keine Spiele – stelle in Steam unter Profil → Privatsphäre die „Spieldetails“ auf Öffentlich.');
  return r.response.games.filter(g => !NOT_GAMES.test(g.name)).map(g => ({
    store: 'Steam', name: g.name, steamId: g.appid, ownId: g.appid, installed: false, playtimeH: Math.round(g.playtime_forever / 6) / 10,
  }));
}

function scanEpic() {
  const games = [];
  const manifestDir = 'C:/ProgramData/Epic/EpicGamesLauncher/Data/Manifests';
  if (process.platform === 'win32' && fs.existsSync(manifestDir)) {
    for (const f of fs.readdirSync(manifestDir).filter(f => f.endsWith('.item'))) {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(manifestDir, f), 'utf8'));
        if (j.bIsApplication === false || (j.AppCategories || []).includes('addons')) continue;
        if (j.MainGameAppName && j.MainGameAppName !== j.AppName) continue;
        games.push({ store: 'Epic', name: j.DisplayName, epicId: j.CatalogItemId, appName: j.AppName, installed: true, sizeGb: j.InstallSize ? +(j.InstallSize / 1024 ** 3).toFixed(1) : null });
      } catch {}
    }
  }
  const cat = path.join(process.env.LOCALAPPDATA || '', 'EpicGamesLauncher/Saved/Data/Catalog/catcache.bin');
  if (fs.existsSync(cat)) {
    try {
      const items = JSON.parse(Buffer.from(fs.readFileSync(cat, 'utf8'), 'base64').toString('utf8'));
      for (const it of items) {
        const cats = (it.categories || []).map(c => c.path);
        if (!cats.includes('games') || it.mainGameItem || cats.includes('addons') || cats.includes('digitalextras')) continue;
        if (games.some(g => g.epicId === it.id)) continue;
        const img = (it.keyImages || []).find(k => /DieselGameBox$|OfferImageWide|DieselStoreFrontWide/.test(k.type));
        const tall = (it.keyImages || []).find(k => /DieselGameBoxTall|OfferImageTall/.test(k.type));
        games.push({ store: 'Epic', name: it.title, epicId: it.id, installed: false, epicDesc: it.description, epicImg: img && img.url, epicTall: tall && tall.url });
      }
    } catch {}
  }
  for (const p of [path.join(os.homedir(), '.config/legendary/installed.json'), path.join(process.env.APPDATA || '', 'heroic/legendaryConfig/legendary/installed.json')]) {
    if (!fs.existsSync(p)) continue;
    try { for (const g of Object.values(JSON.parse(fs.readFileSync(p, 'utf8')))) if (!games.some(x => x.name === g.title)) games.push({ store: 'Epic', name: g.title, appName: g.app_name, installed: true }); } catch {}
  }
  return games;
}

function scanGog() {
  const games = [];
  if (process.platform === 'win32') {
    try {
      const out = run('reg query "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games" /s');
      for (const block of out.split(/\r?\n\r?\n/)) {
        const name = (block.match(/gameName\s+REG_SZ\s+(.+)/) || [])[1];
        const id = (block.match(/gameID\s+REG_SZ\s+(\d+)/) || [])[1];
        if (name) games.push({ store: 'GOG', name: name.trim(), gogId: id ? +id : null, installed: true });
      }
    } catch {}
  }
  const db = 'C:/ProgramData/GOG.com/Galaxy/storage/galaxy-2.0.db';
  if (process.platform === 'win32' && fs.existsSync(db)) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const d = new DatabaseSync(db, { readOnly: true });
      const rows = d.prepare(`SELECT lr.releaseKey AS k, gp.value AS v FROM LibraryReleases lr
        JOIN GamePieces gp ON gp.releaseKey = lr.releaseKey JOIN GamePieceTypes t ON t.id = gp.gamePieceTypeId
        WHERE lr.releaseKey LIKE 'gog\\_%' ESCAPE '\\' AND t.type IN ('title','originalTitle')`).all();
      for (const r of rows) {
        const id = +r.k.slice(4);
        let title; try { title = JSON.parse(r.v).title; } catch {}
        if (!title || games.some(g => g.gogId === id)) continue;
        games.push({ store: 'GOG', name: title, gogId: id, installed: false });
      }
      d.close();
    } catch {}
  }
  return games;
}

// ---------------------------------------------------------------------------
// Weitere Launcher: installierte Spiele erkennen
// (EA app, Ubisoft Connect, Battle.net, Rockstar, Amazon Games, Riot, Xbox/Game Pass, itch.io)
// ---------------------------------------------------------------------------
function regDump(key) {
  try {
    const out = run(`reg query "${key}" /s`, { maxBuffer: 64 * 1024 * 1024 });
    const blocks = [];
    let cur = null;
    for (const line of out.split(/\r?\n/)) {
      if (/^HKEY_/.test(line)) { cur = { key: line.trim(), v: {} }; blocks.push(cur); continue; }
      const m = line.match(/^\s{4}(.+?)\s{4}REG_\w+\s{4}(.*)$/);
      if (m && cur) cur.v[m[1]] = m[2].trim();
    }
    return blocks;
  } catch { return []; }
}

const LAUNCHER_RULES = [
  { store: 'Ubisoft', test: s => /Ubisoft Game Launcher|uplay:\/\/uninstall/i.test(s), skip: /^Ubisoft Connect$|^Uplay$/i,
    launch: (v, k) => { const id = (`${v.UninstallString} ${k}`.match(/uplay:\/\/uninstall\/(\d+)|Uplay Install (\d+)/i) || []).slice(1).find(Boolean); return id ? { uri: `uplay://launch/${id}/0` } : null; } },
  { store: 'EA', test: s => /EA Desktop|EADesktop|\\Origin\\|__Installer\\Cleanup|Electronic Arts\\EA Desktop/i.test(s), skip: /^EA app$|^Origin$|EA Desktop/i },
  { store: 'Battle.net', test: s => /Blizzard Uninstaller|Battle\.net.*--uid=/i.test(s), skip: /^Battle\.net$/i },
  { store: 'Rockstar', test: s => /Rockstar Games\\Launcher\\uninstall\.exe.*-uninstall=/i.test(s), skip: /Rockstar Games Launcher|Social Club/i },
  { store: 'Amazon', test: s => /Amazon Game Remover/i.test(s), skip: /^Amazon Games$/i,
    launch: v => { const id = (String(v.UninstallString).match(/-p\s+"?([\w.-]+)/) || [])[1]; return id ? { uri: `amazon-games://play/${id}` } : null; } },
  { store: 'Riot', test: s => /RiotClientServices\.exe.*--uninstall-product=/i.test(s), skip: /^Riot Client$/i,
    launch: v => { const u = String(v.UninstallString); const exe = (u.match(/"([^"]*RiotClientServices\.exe)"/i) || [])[1]; const prod = (u.match(/--uninstall-product=(\w+)/) || [])[1]; const pl = (u.match(/--uninstall-patchline=(\w+)/) || [])[1] || 'live'; return exe && prod ? { exe, args: [`--launch-product=${prod}`, `--launch-patchline=${pl}`] } : null; } },
];

function scanOtherLaunchers() {
  if (process.platform !== 'win32') return [];
  const games = [];
  const roots = ['HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'];
  for (const root of roots) {
    for (const { key, v } of regDump(root)) {
      const name = v.DisplayName;
      if (!name || /Steam App \d+/.test(key)) continue;
      const hay = [v.UninstallString, v.DisplayIcon, v.InstallLocation, v.Publisher, v.QuietUninstallString].filter(Boolean).join(' | ');
      const rule = LAUNCHER_RULES.find(r => r.test(hay));
      if (!rule || rule.skip.test(name) || NOT_GAMES.test(name)) continue;
      if (games.some(g => g.store === rule.store && normName(g.name) === normName(name))) continue;
      let launch = rule.launch ? rule.launch(v, key) : null;
      if (!launch) {
        const icon = String(v.DisplayIcon || '').replace(/^"|"?,\s*-?\d+$|"$/g, '');
        if (/\.exe$/i.test(icon) && fs.existsSync(icon) && !/unins|uninstall|cleanup|remover/i.test(icon)) launch = { exe: icon, args: [] };
      }
      games.push({ store: rule.store, name: name.replace(/\s*\(.*?(64|32)-?bit.*?\)\s*$/i, '').trim(), installed: true, installDir: v.InstallLocation || null, sizeGb: v.EstimatedSize ? +(parseInt(v.EstimatedSize, 16) / 1024 / 1024).toFixed(1) || null : null, launch });
    }
  }
  // Xbox / Microsoft Store (Game Pass): Ordner "XboxGames" auf allen Laufwerken
  for (const d of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const base = `${d}:\\XboxGames`;
    let dirs = [];
    try { if (!fs.existsSync(base)) continue; dirs = fs.readdirSync(base); } catch { continue; }
    for (const dir of dirs) {
      const cfgPath = path.join(base, dir, 'Content', 'MicrosoftGame.config');
      if (!fs.existsSync(cfgPath)) continue;
      try {
        const x = fs.readFileSync(cfgPath, 'utf8');
        const ident = (x.match(/<Identity[^>]*\sName="([^"]+)"/) || [])[1];
        const title = (x.match(/DefaultDisplayName="([^"]+)"/) || [])[1] || dir;
        const appId = (x.match(/<Executable[^>]*\sId="([^"]+)"/) || [])[1] || 'Game';
        if (!/^ms-resource:/i.test(title)) games.push({ store: 'Xbox', name: decodeHtml(title), installed: true, installDir: path.join(base, dir), launch: ident ? { xbox: ident, appId } : null });
      } catch {}
    }
  }
  // itch.io-App: installierte Spiele aus der lokalen Datenbank
  const itchDb = path.join(process.env.APPDATA || '', 'itch', 'db', 'butler.db');
  if (fs.existsSync(itchDb)) {
    try {
      const { DatabaseSync } = require('node:sqlite');
      const d = new DatabaseSync(itchDb, { readOnly: true });
      for (const r of d.prepare('SELECT c.id AS cave, g.id AS gid, g.title, g.cover_url AS cover, g.short_text AS txt, g.url FROM caves c JOIN games g ON g.id = c.game_id').all()) {
        games.push({ store: 'itch.io', name: r.title, itchId: r.gid, installed: true, epicImg: r.cover, epicDesc: r.txt, url: r.url, launch: { uri: `itch://caves/${r.cave}/launch` } });
      }
      d.close();
    } catch {}
  }
  return games;
}

/** itch.io: alle gekauften/geschenkten Spiele über den offiziellen API-Schlüssel. */
async function scanItchOwned(acc) {
  const key = acc.itch && acc.itch.api_key;
  if (!key) return [];
  const games = [];
  for (let page = 1; page < 50; page++) {
    const r = await fetch(`https://itch.io/api/1/${encodeURIComponent(key)}/my-owned-keys?page=${page}`, { headers: UA });
    if (!r.ok) throw new Error(`itch.io antwortet mit ${r.status}`);
    const j = await r.json();
    if (j.errors) throw new Error('itch.io: ' + j.errors.join(', '));
    const keys = j.owned_keys || [];
    for (const k of keys) {
      const g = k.game || {};
      if (!g.title || (g.classification && g.classification !== 'game')) continue;
      if (games.some(x => x.itchId === g.id)) continue;
      games.push({ store: 'itch.io', name: g.title, itchId: g.id, installed: false, epicImg: g.cover_url, epicDesc: g.short_text, url: g.url });
    }
    if (keys.length < (j.per_page || 50)) break;
  }
  return games;
}

function launchOther(g) {
  const L = g.launch;
  if (!L) return false;
  if (L.uri && /^(uplay|amazon-games|itch):\/\//.test(L.uri)) { openExternal(L.uri); return true; }
  if (L.exe && fs.existsSync(L.exe)) { spawn(L.exe, L.args || [], { cwd: path.dirname(L.exe), detached: true, stdio: 'ignore' }).unref(); return true; }
  if (L.xbox && /^[\w.-]+$/.test(L.xbox)) {
    const pfn = ps(`(Get-AppxPackage -Name '${L.xbox}' | Select-Object -First 1).PackageFamilyName`);
    if (pfn) { spawn('explorer.exe', [`shell:AppsFolder\\${pfn}!${L.appId || 'Game'}`], { detached: true, stdio: 'ignore' }).unref(); return true; }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Konten: Epic / GOG (dieselben öffentlichen Launcher-Zugänge wie Legendary/Heroic bzw. lgogdownloader)
// ---------------------------------------------------------------------------
const EPIC = {
  client: '34a02cf8f4414e29b15921876da36f9a', secret: 'daafbccc737745039dffe53d94fc76cf',
  token: 'https://account-public-service-prod03.ol.epicgames.com/account/api/oauth/token',
  login: 'https://www.epicgames.com/id/login?redirectUrl=' + encodeURIComponent('https://www.epicgames.com/id/api/redirect?clientId=34a02cf8f4414e29b15921876da36f9a&responseType=code'),
};
const GOG = { client: '46899977096215655', secret: '9d85c43b1482497dbbce61f6e4aa173a433796eeae2ca8c5f6129f2dc4de46d9', redirect: 'https://embed.gog.com/on_login_success?origin=client' };
GOG.login = `https://auth.gog.com/auth?client_id=${GOG.client}&redirect_uri=${encodeURIComponent(GOG.redirect)}&response_type=code&layout=client2`;

async function epicToken(params) {
  const r = await fetch(EPIC.token, {
    method: 'POST',
    headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'basic ' + Buffer.from(`${EPIC.client}:${EPIC.secret}`).toString('base64') },
    body: new URLSearchParams({ ...params, token_type: 'eg1' }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.errorMessage || j.error || r.status);
  return j;
}
async function gogToken(params) {
  const r = await fetch('https://auth.gog.com/token?' + new URLSearchParams({ client_id: GOG.client, client_secret: GOG.secret, ...params }), { headers: UA });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || r.status);
  return j;
}

async function scanEpicOwned(acc, cache) {
  if (!acc.epic || !acc.epic.refresh_token) return [];
  try {
    const t = await epicToken({ grant_type: 'refresh_token', refresh_token: acc.epic.refresh_token });
    acc.epic.refresh_token = t.refresh_token; saveAccounts(acc);
    const H = { ...UA, Authorization: 'bearer ' + t.access_token };
    const recs = [];
    let cursor = '';
    do {
      const r = await (await fetch('https://library-service.live.use1a.on.epicgames.com/library/api/public/items?includeMetadata=true' + (cursor ? '&cursor=' + cursor : ''), { headers: H })).json();
      recs.push(...(r.records || []));
      cursor = r.responseMetadata && r.responseMetadata.nextCursor;
    } while (cursor);
    const games = [];
    for (const rec of recs) {
      if (rec.namespace === 'ue' || !rec.catalogItemId) continue;
      const key = `epiccat:${rec.catalogItemId}`;
      let it = cache[key];
      if (!it) {
        try {
          const u = `https://catalog-public-service-prod06.ol.epicgames.com/catalog/api/shared/namespace/${rec.namespace}/bulk/items?id=${rec.catalogItemId}&includeDLCDetails=true&includeMainGameDetails=true&country=DE&locale=de`;
          const c = (await (await fetch(u, { headers: H })).json())[rec.catalogItemId] || {};
          const img = (c.keyImages || []).find(k => /DieselGameBox$|OfferImageWide|DieselStoreFrontWide/.test(k.type));
          const tall = (c.keyImages || []).find(k => /DieselGameBoxTall|OfferImageTall/.test(k.type));
          it = cache[key] = { title: c.title, desc: c.description, img: img && img.url, tall: tall && tall.url, cats: (c.categories || []).map(x => x.path), dlc: !!c.mainGameItem };
        } catch { continue; }
      }
      if (!it.title || it.dlc || !it.cats.includes('games') || it.cats.includes('addons')) continue;
      if (games.some(g => g.epicId === rec.catalogItemId)) continue;
      games.push({ store: 'Epic', name: it.title, epicId: rec.catalogItemId, appName: rec.appName, installed: false, epicDesc: it.desc, epicImg: it.img, epicTall: it.tall });
    }
    cache._epicOwned = games.map(g => ({ ...g })); cache._epicOwnedDate = new Date().toLocaleDateString('de-DE');
    return games;
  } catch (e) {
    log(`Epic-Anmeldung abgelaufen (${e.message}) – bitte unter „Konten“ neu verbinden.`);
    broadcast({ type: 'warn', text: 'Epic-Anmeldung abgelaufen – bitte unter „Konten“ neu verbinden.' });
    return cache._epicOwned ? cache._epicOwned.map(g => ({ ...g })) : [];
  }
}

async function scanGogOwned(acc, cache) {
  if (!acc.gog || !acc.gog.refresh_token) return [];
  try {
    const H = { ...UA, Authorization: 'Bearer ' + await gogAccessToken() };
    const games = [];
    let page = 1, total = 1;
    do {
      const r = await (await fetch(`https://embed.gog.com/account/getFilteredProducts?mediaType=1&page=${page}`, { headers: H })).json();
      total = r.totalPages || 1;
      for (const p of r.products || []) games.push({ store: 'GOG', name: p.title, gogId: p.id, installed: false, epicImg: p.image ? `https:${p.image}_392.jpg` : null });
    } while (++page <= total);
    cache._gogOwned = games.map(g => ({ ...g })); cache._gogOwnedDate = new Date().toLocaleDateString('de-DE');
    return games;
  } catch (e) {
    log(`GOG-Anmeldung abgelaufen (${e.message}) – bitte unter „Konten“ neu verbinden.`);
    broadcast({ type: 'warn', text: 'GOG-Anmeldung abgelaufen – bitte unter „Konten“ neu verbinden.' });
    return cache._gogOwned ? cache._gogOwned.map(g => ({ ...g })) : [];
  }
}

// ---------------------------------------------------------------------------
// Metadaten
// ---------------------------------------------------------------------------
let lastSteamCall = 0;
async function steamFetch(url) {
  for (let i = 0; i < 4; i++) {
    const wait = 1600 - (Date.now() - lastSteamCall);
    if (wait > 0) await sleep(wait);
    lastSteamCall = Date.now();
    const r = await fetch(url, { headers: UA });
    if (r.status === 429 || r.status === 403) {
      const s = 60 * (i + 1);
      broadcast({ type: 'progress-note', text: `Steam bremst zu viele Anfragen – Pause ${s} s, danach geht es automatisch weiter …` });
      await sleep(s * 1000); continue;
    }
    if (!r.ok) return null;
    return r.json();
  }
  throw new Error('Steam-Anfragelimit erreicht');
}

const normName = s => String(s).toLowerCase().replace(/[™®©:'’\-–_.,!?]/g, ' ').replace(/\b(the|edition|game of the year|goty|definitive|enhanced|remastered|complete)\b/g, ' ').replace(/\s+/g, ' ').trim();

async function findSteamIdByName(name) {
  const short = name.replace(/\s*[-–—]\s*[^-–—]*(edition|goty|game of the year|director'?s cut|remaster|bundle|collection)[^-–—]*$/i, '')
    .replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s*(game of the year|goty|complete|definitive|enhanced|deluxe|gold|ultimate)?\s*edition\s*$/i, '').trim();
  for (const t of [...new Set([name, short])]) {
    const r = await steamFetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(t)}&l=german&cc=de`);
    const items = (r && r.items) || [];
    const n = normName(t);
    const hit = items.find(i => normName(i.name) === n) || items.find(i => normName(i.name).startsWith(n) || n.startsWith(normName(i.name)));
    if (hit) return hit.id;
  }
  return null;
}

async function steamDetails(appid) {
  const r = await steamFetch(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=german&cc=de`);
  const d = r && r[appid] && r[appid].success && r[appid].data;
  if (!d) return null;
  let deck = null, proton = null;
  try {
    const dk = await steamFetch(`https://store.steampowered.com/saleaction/ajaxgetdeckappcompatibilityreport?nAppID=${appid}`);
    deck = ['unbekannt', 'nicht unterstützt', 'spielbar', 'verifiziert'][dk.results.resolved_category] || null;
  } catch {}
  try { const p = await fetch(`https://www.protondb.com/api/v1/reports/summaries/${appid}.json`, { headers: UA }); if (p.ok) proton = (await p.json()).tier; } catch {}
  return {
    steamId: appid,
    desc: stripHtml(d.short_description),
    genres: (d.genres || []).map(g => g.description),
    img: d.header_image,
    bg: d.background_raw || d.background || null,
    shots: (d.screenshots || []).slice(0, 6).map(s => s.path_thumbnail),
    meta: d.metacritic ? d.metacritic.score : null,
    release: d.release_date ? d.release_date.date : null,
    dev: (d.developers || []).join(', '),
    platforms: d.platforms || {},
    controller: d.controller_support || null,
    min: parseReq(d.pc_requirements && d.pc_requirements.minimum),
    rec: parseReq(d.pc_requirements && d.pc_requirements.recommended),
    deck, proton,
    url: `https://store.steampowered.com/app/${appid}`,
  };
}

async function gogDetails(id) {
  try {
    const r = await fetch(`https://api.gog.com/products/${id}?expand=description&locale=de-DE`, { headers: UA });
    if (!r.ok) return null;
    const g = await r.json();
    const lead = stripHtml((g.description && (g.description.lead || g.description.full)) || '').split('\n').filter(Boolean).slice(0, 2).join(' ');
    return {
      desc: lead.length > 400 ? lead.slice(0, 400).replace(/\s\S*$/, '') + ' …' : lead,
      img: g.images && g.images.logo2x ? 'https:' + g.images.logo2x : (g.images && g.images.background ? 'https:' + g.images.background : null),
      platforms: g.content_system_compatibility || {},
      url: g.links && g.links.product_card,
    };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// Angebote (Steam, GOG, Epic) + Favoriten
// ---------------------------------------------------------------------------
const DEALS_FILE = F('angebote.json');
const FAV_FILE = F('favoriten.json');
const loadFavs = () => readJson(FAV_FILE, {});
const decodeHtml = s => String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').trim();
const steamHeader = id => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/header.jpg`;
const steamTall = id => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${id}/library_600x900.jpg`;

async function steamDeals() {
  const out = [];
  for (let start = 0; start < 200; start += 50) {
    const r = await fetch(`https://store.steampowered.com/search/results/?query&start=${start}&count=50&specials=1&infinite=1&cc=de&l=german&category1=998`, { headers: UA });
    if (!r.ok) break;
    const j = await r.json();
    for (const row of String(j.results_html || '').split('<a href=').slice(1)) {
      const id = (row.match(/data-ds-appid="(\d+)"/) || [])[1];
      if (!id || out.some(d => d.id === id)) continue;
      const pct = +((row.match(/data-discount="(\d+)"/) || [])[1] || 0);
      if (!pct) continue;
      const fin = +((row.match(/data-price-final="(\d+)"/) || [])[1] || 0);
      const rev = (row.match(/data-tooltip-html="[^"]*?(\d+)\s?%/) || [])[1];
      out.push({
        store: 'Steam', id, steamId: +id,
        title: decodeHtml((row.match(/<span class="title">([^<]*)<\/span>/) || [])[1]),
        discount: pct, price: fin / 100, currency: 'EUR',
        priceText: decodeHtml((row.match(/discount_final_price">([^<]*)</) || [])[1]),
        origText: decodeHtml((row.match(/discount_original_price">([^<]*)</) || [])[1]),
        rating: rev ? +rev : null,
        released: decodeHtml((row.match(/search_released[^>]*>([^<]*)</) || [])[1]),
        img: steamHeader(id), tall: steamTall(id),
        thumb: (row.match(/<img src="([^"]+)"/) || [])[1],
        url: `https://store.steampowered.com/app/${id}`,
      });
    }
    if (out.length >= j.total_count) break;
  }
  return out;
}

async function gogDeals() {
  const r = await fetch('https://catalog.gog.com/v1/catalog?limit=100&order=desc:trending&discounted=eq:true&productType=in:game,pack&countryCode=DE&locale=de-DE&currencyCode=EUR', { headers: UA });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.products || []).map(p => ({
    store: 'GOG', id: String(p.id), gogId: +p.id, title: p.title,
    discount: Math.abs(parseInt(p.price && p.price.discount, 10) || 0),
    price: p.price && p.price.finalMoney ? +p.price.finalMoney.amount : null, currency: 'EUR',
    priceText: p.price && p.price.final, origText: p.price && p.price.base,
    rating: p.reviewsRating ? p.reviewsRating * 2 : null,
    released: p.releaseDate ? p.releaseDate.split('.').reverse().join('.') : null,
    genres: (p.genres || []).map(g => g.name),
    img: p.coverHorizontal, tall: p.coverVertical, url: p.storeLink,
  })).filter(d => d.discount > 0);
}

async function epicFree() {
  const r = await fetch('https://store-site-backend-static-ipv4.ak.epicgames.com/freeGamesPromotions?locale=de&country=DE&allowCountries=DE', { headers: UA });
  if (!r.ok) return [];
  const els = ((((await r.json()).data || {}).Catalog || {}).searchStore || {}).elements || [];
  const now = Date.now();
  const out = [];
  for (const e of els) {
    if (e.offerType === 'ADD_ON') continue;
    const pick = list => (list || []).flatMap(x => x.promotionalOffers || []).find(o => o.discountSetting && o.discountSetting.discountPercentage === 0);
    const cur = pick(e.promotions && e.promotions.promotionalOffers);
    const soon = pick(e.promotions && e.promotions.upcomingPromotionalOffers);
    const o = cur && new Date(cur.startDate) <= now && new Date(cur.endDate) > now ? { free: 'jetzt', ...cur } : soon ? { free: 'bald', ...soon } : null;
    if (!o) continue;
    const img = k => ((e.keyImages || []).find(x => x.type === k) || {}).url;
    const slug = ((e.offerMappings || [])[0] || {}).pageSlug || (((e.catalogNs || {}).mappings || [])[0] || {}).pageSlug || String(e.productSlug || '').replace(/\/home$/, '');
    out.push({
      store: 'Epic', id: e.id, title: e.title, free: o.free, start: o.startDate, end: o.endDate,
      discount: 100, price: 0, currency: 'EUR', priceText: 'Gratis',
      origText: e.price && e.price.totalPrice && e.price.totalPrice.fmtPrice ? e.price.totalPrice.fmtPrice.originalPrice : null,
      desc: e.description, img: img('OfferImageWide') || img('DieselStoreFrontWide') || img('Thumbnail'), tall: img('OfferImageTall') || img('DieselGameBoxTall'),
      url: slug ? `https://store.epicgames.com/de/p/${slug}` : 'https://store.epicgames.com/de/free-games',
    });
  }
  return out;
}

async function epicDeals() {
  // Epic bietet keine offene Angebots-Schnittstelle -> CheapShark (Preise in US-Dollar)
  const r = await fetch('https://www.cheapshark.com/api/1.0/deals?storeID=25&onSale=1&pageSize=60&sortBy=Deal%20Rating', { headers: UA });
  if (!r.ok) return [];
  return (await r.json()).filter(d => +d.salePrice > 0 && +d.savings >= 1).map(d => ({
    store: 'Epic', id: d.dealID, title: d.title, steamId: +d.steamAppID || null,
    discount: Math.round(+d.savings), price: +d.salePrice, currency: 'USD',
    priceText: `${(+d.salePrice).toFixed(2).replace('.', ',')} $`, origText: `${(+d.normalPrice).toFixed(2).replace('.', ',')} $`,
    rating: +d.steamRatingPercent || null, meta: +d.metacriticScore || null,
    img: +d.steamAppID ? steamHeader(d.steamAppID) : d.thumb, tall: +d.steamAppID ? steamTall(d.steamAppID) : null, thumb: d.thumb,
    url: `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
  }));
}

let dealsLoading = null;
async function loadDeals(refresh) {
  const cached = readJson(DEALS_FILE, null);
  if (!refresh && cached && Date.now() - cached.at < 3 * 3600e3) return cached;
  if (dealsLoading) return dealsLoading;
  dealsLoading = (async () => {
    const [steam, gog, free, epic] = await Promise.all([steamDeals(), gogDeals(), epicFree(), epicDeals()].map(p => p.catch(e => { log('Angebote: ' + e.message); return []; })));
    const res = { at: Date.now(), deals: [...free, ...steam, ...epic, ...gog] };
    if (res.deals.length) writeJson(DEALS_FILE, res);
    return res.deals.length ? res : (cached || res);
  })().finally(() => { dealsLoading = null; });
  return dealsLoading;
}

/** Markiert Angebote, die schon in der Bibliothek sind (gleiche Steam-ID oder gleicher Name). */
function markOwned(deals) {
  const ids = new Set(), names = new Map();
  for (const g of library.games || []) {
    if (g.steamId) ids.add(g.steamId);
    if (!names.has(normName(g.name))) names.set(normName(g.name), []);
    names.get(normName(g.name)).push(g.store);
  }
  return deals.map(d => {
    const stores = names.get(normName(d.title)) || [];
    return { ...d, owned: (d.steamId && ids.has(d.steamId)) || stores.length > 0, ownedOn: [...new Set(stores)] };
  });
}

const gameKey = g => `${g.store}:${g.ownId || g.epicId || g.gogId || g.itchId || normName(g.name)}`;

// ---------------------------------------------------------------------------
// Downloads & Installationswarteschlange
//  - GOG: offizielle Offline-Installer direkt herunterladen (mit Fortsetzen) und still installieren
//  - Steam/Epic: Installation nacheinander an den jeweiligen Launcher übergeben
// ---------------------------------------------------------------------------
const QUEUE_FILE = F('warteschlange.json');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
const DL_DEFAULTS = {
  install_dir: 'C:\\GOG Games',
  download_dir: path.join(os.homedir(), 'Downloads', 'GOG-Installer'),
  delete_installer: true,
  auto_install: true,
};
const dlSettings = () => ({ ...DL_DEFAULTS, ...(loadConfig().downloads || {}) });
const safeName = s => String(s).replace(/[<>:"/\\|?*\u0000-\u001f™®©]/g, '').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '').slice(0, 80) || 'Spiel';

let queue = readJson(QUEUE_FILE, { items: [] });
for (const it of queue.items) if (['lädt', 'prüft', 'installiert gerade'].includes(it.status)) it.status = 'pausiert';
const saveQueue = () => writeJson(QUEUE_FILE, queue, true);
let queueWorker = null, activeCtl = null, lastQBroadcast = 0;
const publicQueue = () => queue.items.map(({ ctl, ...rest }) => rest);
function queueChanged(force) {
  const now = Date.now();
  if (!force && now - lastQBroadcast < 400) return;
  lastQBroadcast = now;
  broadcast({ type: 'queue', items: publicQueue() });
}
const queueBusy = () => queue.items.some(i => ['wartet', 'lädt', 'prüft', 'installiert gerade'].includes(i.status));

let gogAccess = null;
async function gogAccessToken() {
  if (gogAccess && gogAccess.until > Date.now() + 60000) return gogAccess.token;
  const acc = loadAccounts();
  if (!acc.gog || !acc.gog.refresh_token) throw new Error('GOG ist nicht verbunden – bitte unter „Konten“ verbinden.');
  const t = await gogToken({ grant_type: 'refresh_token', refresh_token: acc.gog.refresh_token });
  acc.gog.refresh_token = t.refresh_token; saveAccounts(acc);
  gogAccess = { token: t.access_token, until: Date.now() + (t.expires_in || 3600) * 1000 };
  return gogAccess.token;
}

const parseSize = s => { const m = String(s || '').match(/([\d.,]+)\s*(KB|MB|GB|TB)/i); return m ? parseFloat(m[1].replace(',', '.')) * { kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3, tb: 1024 ** 4 }[m[2].toLowerCase()] : 0; };
function freeBytes(p) {
  let dir = path.resolve(p);
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir);
  try { const s = fs.statfsSync(dir); return s.bavail * s.bsize; } catch { return null; }
}
const gb = b => (b / 1024 ** 3).toFixed(1).replace('.', ',') + ' GB';

/** Holt die Installer-Liste eines GOG-Spiels (bevorzugt deutsch, sonst englisch). */
async function gogInstallers(gogId) {
  const tok = await gogAccessToken();
  const r = await fetch(`https://embed.gog.com/account/gameDetails/${gogId}.json`, { headers: { ...UA, Authorization: 'Bearer ' + tok } });
  if (!r.ok) throw new Error(`GOG-Spieldetails nicht abrufbar (${r.status})`);
  const d = await r.json();
  const langs = (d.downloads || []).filter(x => x[1] && x[1].windows && x[1].windows.length);
  if (!langs.length) throw new Error('Für dieses Spiel gibt es keinen Windows-Installer.');
  const pick = langs.find(x => /deutsch|german/i.test(x[0])) || langs.find(x => /english/i.test(x[0])) || langs[0];
  // Nur den vollständigen Installer (inkl. .bin-Teile), keine Update-Patches
  const files = pick[1].windows.filter(w => !/patch/i.test(`${w.name} ${w.manualUrl}`));
  return { lang: pick[0], files: (files.length ? files : pick[1].windows).map(w => ({ url: 'https://embed.gog.com' + w.manualUrl, label: w.name, version: w.version, size: parseSize(w.size) })) };
}

/** Folgt dem GOG-Link zur CDN-Adresse und ermittelt Dateiname + Größe. */
async function resolveDownload(url, signal) {
  const tok = await gogAccessToken();
  const r = await fetch(url, { headers: { ...UA, Authorization: 'Bearer ' + tok, Range: 'bytes=0-0' }, signal });
  if (!r.ok && r.status !== 206) throw new Error(`Download-Link ungültig (${r.status})`);
  try { await r.body.cancel(); } catch {}
  const total = +(((r.headers.get('content-range') || '').split('/')[1]) || r.headers.get('content-length') || 0);
  let name = decodeURIComponent(new URL(r.url).pathname.split('/').pop() || '');
  if (!/\.(exe|bin)$/i.test(name)) name = '';
  return { finalUrl: r.url, total, name };
}

async function downloadFile(url, dest, it, file, signal) {
  const have = fs.existsSync(dest) ? fs.statSync(dest).size : 0;
  if (file.size && have >= file.size) { file.done = file.size; return; }
  const r = await fetch(url, { headers: { ...UA, ...(have ? { Range: `bytes=${have}-` } : {}) }, signal });
  if (!(r.ok || r.status === 206)) throw new Error(`Download fehlgeschlagen (${r.status})`);
  const append = have && r.status === 206;
  file.done = append ? have : 0;
  let winStart = Date.now(), winBytes = 0;
  const meter = new Transform({
    transform(chunk, _e, cb) {
      file.done += chunk.length; winBytes += chunk.length;
      const dt = Date.now() - winStart;
      if (dt > 1000) { it.speed = Math.round(winBytes / dt * 1000 * 0.6 + (it.speed || 0) * 0.4); winStart = Date.now(); winBytes = 0; }
      it.done = it.files.reduce((a, f) => a + (f.done || 0), 0);
      queueChanged();
      cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(r.body), meter, fs.createWriteStream(dest, { flags: append ? 'a' : 'w' }), { signal });
}

function runInstaller(exe, dir) {
  // Start-Process nutzt ShellExecute -> Windows fragt selbst nach Administratorrechten, falls der Installer sie braucht.
  const q = s => s.replace(/'/g, "''");
  const argList = ['/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/SP-', `/DIR="${dir}"`].map(a => `'${q(a)}'`).join(',');
  const cmd = `$ErrorActionPreference='Stop'; try { $p = Start-Process -FilePath '${q(exe)}' -ArgumentList ${argList} -Wait -PassThru; exit $p.ExitCode } catch { Write-Output $_.Exception.Message; exit 9999 }`;
  return new Promise((resolve, reject) => {
    const p = spawn('powershell', ['-NoProfile', '-Command', cmd], { windowsHide: true });
    let out = ''; p.stdout.on('data', d => out += d);
    p.on('error', reject);
    p.on('exit', code => {
      if (code === 0) return resolve();
      if (code === 9999) return reject(new Error(/abgebrochen|canceled|cancelled/i.test(out) ? 'Installation abgebrochen (Administratorrechte nicht erteilt).' : 'Installer konnte nicht gestartet werden: ' + out.trim()));
      reject(new Error(`Installer beendet mit Fehlercode ${code}`));
    });
  });
}

function markInstalled(key, dir) {
  const g = (library.games || []).find(x => gameKey(x) === key);
  if (!g) return;
  g.installed = true; if (dir) g.installDir = dir;
  writeJson(LIB_FILE, library);
  broadcast({ type: 'update' });
}

async function processGog(it, signal) {
  const set = dlSettings();
  it.status = 'prüft'; it.error = null; queueChanged(true);
  const inst = await gogInstallers(it.gogId);
  it.lang = inst.lang;
  const folder = path.join(set.download_dir, safeName(it.name));
  fs.mkdirSync(folder, { recursive: true });
  // Exakte Größen + Dateinamen ermitteln
  const prev = it.files || [];
  it.files = [];
  for (let n = 0; n < inst.files.length; n++) {
    const f = inst.files[n];
    const res = await resolveDownload(f.url, signal);
    const name = res.name || `${safeName(it.name)}_teil${n + 1}${n ? '.bin' : '.exe'}`;
    if (/^patch_/i.test(name)) continue;
    const old = prev.find(p => p.name === name);
    it.files.push({ name, size: res.total || f.size, done: old ? old.done : 0, src: f.url });
  }
  it.total = it.files.reduce((a, f) => a + (f.size || 0), 0);
  it.dir = folder;
  // Speicherplatz prüfen (Download + ungefähr gleich viel für die Installation)
  const freeDl = freeBytes(set.download_dir), freeIn = freeBytes(set.install_dir);
  const left = it.total - it.files.reduce((a, f) => a + Math.min(f.size || 0, fs.existsSync(path.join(folder, f.name)) ? fs.statSync(path.join(folder, f.name)).size : 0), 0);
  const sameDrive = path.parse(path.resolve(set.download_dir)).root.toLowerCase() === path.parse(path.resolve(set.install_dir)).root.toLowerCase();
  if (freeDl != null && freeDl < left + (sameDrive ? it.total : 0)) throw new Error(`Zu wenig Speicherplatz: benötigt ca. ${gb(left + (sameDrive ? it.total : 0))}, frei ${gb(freeDl)}.`);
  if (!sameDrive && freeIn != null && freeIn < it.total) throw new Error(`Zu wenig Speicherplatz im Installationsordner: benötigt ca. ${gb(it.total)}, frei ${gb(freeIn)}.`);

  it.status = 'lädt'; queueChanged(true); saveQueue();
  for (const f of it.files) {
    const fresh = await resolveDownload(f.src, signal); // CDN-Links laufen ab -> jedes Mal neu holen
    await downloadFile(fresh.finalUrl, path.join(folder, f.name), it, f, signal);
    saveQueue();
  }
  it.done = it.total; it.speed = 0;
  const exe = it.files.map(f => f.name).find(n => /^setup_.*\.exe$/i.test(n)) || it.files.map(f => f.name).find(n => /\.exe$/i.test(n));
  if (!set.auto_install || !exe) { it.status = 'heruntergeladen'; it.finishedAt = Date.now(); return; }
  it.status = 'installiert gerade'; queueChanged(true); saveQueue();
  const target = path.join(set.install_dir, safeName(it.name));
  await runInstaller(path.join(folder, exe), target);
  it.installDir = target;
  if (set.delete_installer) { try { fs.rmSync(folder, { recursive: true, force: true }); } catch {} it.deleted = true; }
  it.status = 'installiert'; it.finishedAt = Date.now();
  markInstalled(it.key, target);
}

async function processLauncher(it) {
  let u;
  if (it.store === 'Steam' && it.ownId) u = `steam://install/${+it.ownId}`;
  else if (it.store === 'Epic' && it.appName && /^[\w.-]+$/.test(it.appName)) u = `com.epicgames.launcher://apps/${it.appName}?action=install`;
  else throw new Error('Für dieses Spiel ist kein Installations-Link bekannt.');
  openExternal(u);
  it.status = `an ${it.store} übergeben`; it.finishedAt = Date.now();
  await sleep(5000); // Launcher-Dialoge nicht stapeln
}

function pumpQueue() {
  if (queueWorker) return;
  queueWorker = (async () => {
    for (;;) {
      const it = queue.items.find(i => i.status === 'wartet');
      if (!it) break;
      const ctl = new AbortController(); activeCtl = { id: it.id, ctl };
      try {
        if (it.store === 'GOG') await processGog(it, ctl.signal); else await processLauncher(it);
      } catch (e) {
        if (ctl.signal.aborted) { if (it.status !== 'abgebrochen') it.status = 'pausiert'; }
        else { it.status = 'fehler'; it.error = e.message; log(`Download ${it.name}: ${e.message}`); }
        it.speed = 0;
      }
      activeCtl = null; saveQueue(); queueChanged(true);
    }
  })().finally(() => { queueWorker = null; if (!clients.size) armIdle(15000); });
}

function enqueue(games) {
  let added = 0;
  for (const g of games) {
    const key = gameKey(g);
    const ex = queue.items.find(i => i.key === key && !['installiert', 'abgebrochen', 'fehler', 'heruntergeladen'].includes(i.status) && !/übergeben/.test(i.status));
    if (ex) continue;
    if (!(g.store === 'GOG' && g.gogId) && !(g.store === 'Steam' && g.ownId) && !(g.store === 'Epic' && g.appName)) continue;
    queue.items = queue.items.filter(i => i.key !== key); // alte, abgeschlossene Einträge ersetzen
    queue.items.push({ id: crypto.randomBytes(6).toString('hex'), key, name: g.name, store: g.store, gogId: g.gogId || null, ownId: g.ownId || null, appName: g.appName || null, img: g.img || null, status: 'wartet', done: 0, total: 0, files: [], addedAt: Date.now() });
    added++;
  }
  saveQueue(); queueChanged(true); pumpQueue();
  return added;
}

/** Startet ein installiertes GOG-Spiel direkt (ohne Galaxy) über die Registry-Einträge des Installers. */
function launchGogDirect(gogId) {
  if (process.platform !== 'win32') return false;
  const key = `HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games\\${+gogId}`;
  const exe = regQuery(key, 'exe');
  if (!exe || !fs.existsSync(exe)) return false;
  const wd = regQuery(key, 'workingDir') || path.dirname(exe);
  const params = regQuery(key, 'launchParam') || '';
  spawn(exe, params ? params.match(/(?:[^\s"]+|"[^"]*")+/g).map(a => a.replace(/"/g, '')) : [], { cwd: fs.existsSync(wd) ? wd : path.dirname(exe), detached: true, stdio: 'ignore' }).unref();
  return true;
}
setTimeout(pumpQueue, 3000);

const cacheKey = g => g.steamId ? `steam:${g.steamId}` : `name:${normName(g.name)}`;
async function enrich(game, cache, refresh) {
  const key = cacheKey(game);
  if (!refresh && cache[key]) return Object.assign(game, cache[key], { steamId: cache[key].steamId || game.steamId });
  let info = {};
  const sid = game.steamId || await findSteamIdByName(game.name);
  if (sid) info = (await steamDetails(sid)) || {};
  if (game.gogId && (!info.desc || !sid)) {
    const g = await gogDetails(game.gogId);
    if (g) info = Object.assign({}, g, info, { desc: info.desc || g.desc, img: info.img || g.img, url: g.url || info.url });
  }
  if (!info.desc && game.epicDesc) info.desc = game.epicDesc;
  if (!info.img && game.epicImg) info.img = game.epicImg;
  cache[key] = info;
  return Object.assign(game, info);
}

// ---------------------------------------------------------------------------
// FPS-Schätzung
// ---------------------------------------------------------------------------
const RES_FACTOR = { '720p': 1.6, '800p': 1.45, '1080p': 1, '1200p': 0.88, '1440p': 0.62, 'ultrawide': 0.5, '4k': 0.32 };
const STATUS_ORDER = ['läuft super', 'gut spielbar', 'spielbar', 'vermutlich spielbar', 'grenzwertig', 'unbekannt', 'nicht spielbar', 'nicht verfügbar'];

function estimate(game, dev) {
  const res = RES_FACTOR[String(dev.aufloesung || '1080p').toLowerCase()] || 1;
  const maxFps = +dev.max_fps || 144;
  const r = { status: 'unbekannt', fps: null, preset: null, capped: false, note: [] };
  const plat = game.platforms || {};
  const devOs = String(dev.os || 'windows').toLowerCase();
  if (devOs === 'mac' && plat.windows && plat.mac === false) { r.status = 'nicht verfügbar'; r.note.push('keine Mac-Version'); return r; }
  if (dev.steam_deck && game.deck === 'nicht unterstützt') { r.status = 'nicht spielbar'; r.note.push('Steam Deck: nicht unterstützt'); return r; }
  if (devOs === 'linux' && !plat.linux && game.proton === 'borked') { r.status = 'nicht spielbar'; r.note.push('ProtonDB: borked'); return r; }

  const min = game.min || {}, rec = game.rec || {};
  if (dev.ram_gb && min.ram && dev.ram_gb + 0.5 < min.ram) { r.status = 'nicht spielbar'; r.note.push(`zu wenig RAM (${min.ram} GB nötig)`); return r; }

  const indie = (game.genres || []).some(x => /indie/i.test(x));
  const g = dev.score && indie ? dev.score * 1.8 : dev.score;
  if (g && (min.score || rec.score)) {
    let fpsLow = null, fpsHigh = null;
    if (min.score) fpsLow = 30 * Math.pow(g / min.score, 0.85) * res;
    if (rec.score) fpsHigh = 60 * Math.pow(g / rec.score, 0.85) * res;
    else fpsHigh = 30 * Math.pow(g / (min.score * 2.2), 0.85) * res;
    if (!fpsLow) fpsLow = fpsHigh * 1.8;
    const cap = v => Math.min(Math.round(v), maxFps);
    if (fpsHigh >= 45) { r.fps = cap(fpsHigh); r.preset = 'Hoch'; }
    else if (fpsLow >= 25) { r.fps = cap(Math.min(fpsLow, Math.max(fpsHigh * 1.8, fpsLow * 0.6))); r.preset = 'Niedrig'; }
    else { r.fps = cap(fpsLow); r.preset = 'Niedrig'; }
    r.capped = r.fps >= maxFps;
    if (r.capped && !rec.score) r.preset = 'Hoch';
    r.status = r.fps >= 60 || r.capped ? 'läuft super' : r.fps >= 40 ? 'gut spielbar' : r.fps >= 28 ? 'spielbar' : r.fps >= 18 ? 'grenzwertig' : 'nicht spielbar';
    if (indie) r.note.push('Indie-Spiel: Anforderungen meist großzügig angegeben');
  } else if (g && game.min) {
    r.status = 'vermutlich spielbar'; r.note.push('Grafikanforderung nicht erkannt');
  } else if (!dev.score) {
    r.note.push('Grafikkarte des Geräts unbekannt');
  }
  if (dev.steam_deck && game.deck) {
    r.note.push(`Steam Deck: ${game.deck}`);
    const rank = s => STATUS_ORDER.indexOf(s);
    const lift = status => { if (rank(r.status) > rank(status)) { r.status = status; if (!r.fps || r.fps < 30) { r.fps = Math.min(30, maxFps); r.preset = 'Deck-Standard'; r.capped = false; } } };
    if (game.deck === 'verifiziert') lift('gut spielbar');
    if (game.deck === 'spielbar') lift('spielbar');
  }
  if (devOs === 'linux' && !plat.linux && game.proton) r.note.push(`ProtonDB: ${game.proton}`);
  if (devOs === 'linux' && plat.linux) r.note.push('native Linux-Version');
  return r;
}

// ---------------------------------------------------------------------------
// Einlesen der Bibliothek
// ---------------------------------------------------------------------------
let scanning = null;
async function runScan(refresh = false) {
  if (scanning) return;
  scanning = { text: 'Starte …', done: 0, total: 0 };
  const prog = (text, done = 0, total = 0) => { scanning = { text, done, total }; broadcast({ type: 'progress', text, done, total }); };
  try {
    const cfg = loadConfig(), cache = loadCache(), acc = loadAccounts();
    prog('Suche installierte Spiele …');
    const games = scanSteam();
    let steamOwned = [];
    if (acc.steam && acc.steam.api_key) {
      prog('Lade Steam-Bibliothek …');
      try { steamOwned = await scanSteamOwned(acc); } catch (e) { log('Steam: ' + e.message); broadcast({ type: 'warn', text: 'Steam: ' + e.message }); }
    }
    const epic = scanEpic();
    prog('Lade Epic-Bibliothek …');
    const epicOwned = await scanEpicOwned(acc, cache);
    const gog = scanGog();
    prog('Lade GOG-Bibliothek …');
    const gogOwned = await scanGogOwned(acc, cache);
    for (const g of steamOwned) { const ex = games.find(x => x.steamId === g.steamId); if (ex) ex.playtimeH = g.playtimeH; else games.push(g); }
    for (const g of epicOwned) if (!epic.some(x => (x.epicId && x.epicId === g.epicId) || normName(x.name) === normName(g.name))) epic.push(g); else { const ex = epic.find(x => x.epicId === g.epicId || normName(x.name) === normName(g.name)); if (ex && !ex.appName) ex.appName = g.appName; }
    for (const g of gogOwned) if (!gog.some(x => (x.gogId && x.gogId === g.gogId) || normName(x.name) === normName(g.name))) gog.push(g);
    prog('Suche Spiele weiterer Launcher …');
    const others = scanOtherLaunchers();
    if (acc.itch && acc.itch.api_key) {
      prog('Lade itch.io-Bibliothek …');
      try { for (const g of await scanItchOwned(acc)) if (!others.some(x => x.itchId === g.itchId)) others.push(g); }
      catch (e) { broadcast({ type: 'warn', text: e.message }); }
    }
    const manual = (cfg.manuelle_spiele || []).filter(m => m.name && !m._beispiel).map(m => ({ store: m.store || 'Manuell', name: m.name, steamId: m.steam_id || null, installed: !!m.installiert }));
    for (const g of [...epic, ...gog, ...others, ...manual]) if (!games.some(x => x.store === g.store && normName(x.name) === normName(g.name))) games.push(g);
    log(`Gefunden: ${games.length} Spiele (Steam ${games.filter(g => g.store === 'Steam').length}, Epic ${epic.length}, GOG ${gog.length}, weitere ${others.length})`);

    // Gleichnamige Epic/GOG-Spiele nutzen die Steam-ID aus der Steam-Bibliothek (spart die Suche)
    const steamByName = new Map(games.filter(g => g.store === 'Steam').map(g => [normName(g.name), g.steamId]));
    for (const g of games) if (!g.steamId && steamByName.has(normName(g.name))) g.steamId = steamByName.get(normName(g.name));

    const finish = g => {
      if (!g.img && g.epicImg) g.img = g.epicImg;
      if (g.epicTall) g.tall = g.epicTall;
      delete g.epicDesc; delete g.epicImg; delete g.epicTall;
    };
    const publish = (final) => {
      library = { games, scannedAt: final ? new Date().toISOString() : library.scannedAt, partial: !final };
      writeJson(LIB_FILE, library);
      broadcast({ type: final ? 'done' : 'update', count: games.length });
    };
    // 1. Alles, was schon im Cache liegt, sofort anzeigen
    const todo = [];
    for (const g of games) {
      if (!refresh && cache[cacheKey(g)]) { await enrich(g, cache, false); finish(g); } else todo.push(g);
    }
    publish(false);
    // 2. Fehlende Infos nachladen – installierte und Steam-Spiele zuerst
    todo.sort((a, b) => (b.installed - a.installed) || ((b.steamId ? 1 : 0) - (a.steamId ? 1 : 0)));
    const t0 = Date.now();
    for (let i = 0; i < todo.length; i++) {
      const g = todo[i];
      const left = i > 3 ? Math.ceil((Date.now() - t0) / i * (todo.length - i) / 60000) : null;
      prog(`Lade Spielinfos: ${g.name}${left ? ` · noch ca. ${left} min` : ''}`, i, todo.length);
      try { await enrich(g, cache, refresh); } catch (e) { log(`Fehler bei ${g.name}: ${e.message}`); }
      finish(g);
      if ((i + 1) % 10 === 0) saveCache(cache);
      if ((i + 1) % 25 === 0) publish(false);
    }
    saveCache(cache);
    publish(true);
  } catch (e) {
    log('Fehler beim Einlesen: ' + e.stack);
    broadcast({ type: 'error', text: 'Fehler beim Einlesen: ' + e.message });
  } finally { scanning = null; }
}

// ---------------------------------------------------------------------------
// Zustand für die Oberfläche
// ---------------------------------------------------------------------------
function buildState() {
  const cfg = loadConfig();
  const devices = resolveDevices(cfg);
  const acc = loadAccounts();
  const su = localSteamUser();
  const favs = loadFavs();
  return {
    devices: devices.map(d => ({ name: d.name, auto: !!d.auto, gpu: d.gpu, cpu: d.cpu || null, ram_gb: d.ram_gb, aufloesung: d.aufloesung || '1080p', max_fps: d.max_fps || 144, os: d.os || 'windows', steam_deck: !!d.steam_deck, score: d.score })),
    devicesRaw: cfg.geraete,
    pc: detectThisPc(),
    games: (library.games || []).map(g0 => {
      const g = { ...g0, min: rescoreReq(g0.min), rec: rescoreReq(g0.rec) };
      g.key = gameKey(g); g.fav = favs[g.key] || null;
      g.est = devices.map(d => estimate(g, d));
      return g;
    }),
    scannedAt: library.scannedAt,
    partial: !!library.partial,
    queue: publicQueue(),
    dl: { settings: dlSettings(), free: { install: freeBytes(dlSettings().install_dir), download: freeBytes(dlSettings().download_dir) } },
    scanning,
    order: STATUS_ORDER,
    accounts: {
      steam: { connected: !!(acc.steam && acc.steam.api_key), user: su ? su.name : null, hasLocalId: !!su },
      epic: { connected: !!(acc.epic && acc.epic.refresh_token), name: acc.epic && acc.epic.name },
      gog: { connected: !!(acc.gog && acc.gog.refresh_token) },
      itch: { connected: !!(acc.itch && acc.itch.api_key), name: acc.itch && acc.itch.name },
    },
    gpuList: Object.keys(GPU).filter(k => !/steam deck|rog ally|legion go|igpu/.test(k)).map(prettyGpu).concat(['Steam Deck', 'ROG Ally', 'Legion Go']),
    dataDir: DATA_DIR,
  };
}

function cleanDevice(d) {
  const out = { name: String(d.name || 'Gerät').slice(0, 60) };
  if (d.auto) out.auto = true;
  if (d.gpu && String(d.gpu).trim()) out.gpu = String(d.gpu).trim().slice(0, 80);
  if (+d.ram_gb > 0) out.ram_gb = Math.min(+d.ram_gb, 1024);
  out.aufloesung = RES_FACTOR[d.aufloesung] ? d.aufloesung : '1080p';
  out.max_fps = Math.max(20, Math.min(+d.max_fps || 60, 500));
  out.os = ['windows', 'linux', 'mac'].includes(d.os) ? d.os : 'windows';
  if (d.steam_deck) out.steam_deck = true;
  return out;
}

async function route(p, b) {
  switch (p) {
    case '/api/ping': return { ok: true };
    case '/api/state': return buildState();
    case '/api/scan': runScan(!!b.refresh); return { ok: true };
    case '/api/devices': {
      if (!Array.isArray(b.geraete)) throw new Error('Ungültige Geräteliste');
      const cfg = loadConfig(); cfg.geraete = b.geraete.slice(0, 20).map(cleanDevice); saveConfig(cfg);
      return buildState();
    }
    case '/api/gpucheck': {
      const f = findGpus(b.name || '');
      return { score: gpuScoreOfDevice(b.name || ''), names: f.map(x => prettyGpu(x.name)) };
    }
    case '/api/open': {
      if (!/^https:\/\/[^\s"]+$/.test(b.url || '')) throw new Error('Ungültiger Link');
      openExternal(b.url); return { ok: true };
    }
    case '/api/launch': {
      if (b.key) {
        // Weitere Launcher: Startweg kommt aus der eingelesenen Bibliothek, nicht vom Client
        const g = (library.games || []).find(x => gameKey(x) === b.key);
        if (g && g.launch) { if (launchOther(g)) return { ok: true, direct: true }; throw new Error('Das Spiel konnte nicht gestartet werden – ist der Launcher installiert?'); }
      }
      let u = null;
      if (b.store === 'Steam' && b.ownId) u = b.installed ? `steam://rungameid/${+b.ownId}` : `steam://install/${+b.ownId}`;
      else if (b.store === 'Epic' && b.appName && /^[\w.-]+$/.test(b.appName)) u = `com.epicgames.launcher://apps/${b.appName}?action=launch&silent=true`;
      else if (b.store === 'GOG' && b.gogId) {
        if (b.installed && launchGogDirect(b.gogId)) return { ok: true, direct: true };
        u = `goggalaxy://openGameView/${+b.gogId}`;
      }
      if (!u) throw new Error('Für dieses Spiel ist kein Start-Link bekannt.');
      openExternal(u); return { ok: true };
    }
    case '/api/accounts/open': {
      const urls = { steam: 'https://steamcommunity.com/dev/apikey', epic: EPIC.login, gog: GOG.login, itch: 'https://itch.io/user/settings/api-keys' };
      if (!urls[b.store]) throw new Error('Unbekannter Store');
      openExternal(urls[b.store]); return { ok: true };
    }
    case '/api/accounts/steam': {
      const key = String(b.api_key || '').trim();
      if (!/^[0-9A-Fa-f]{32}$/.test(key)) throw new Error('Der Schlüssel sollte aus 32 Zeichen (0-9, A-F) bestehen.');
      const su = localSteamUser();
      const sid = String(b.steam_id || '').trim() || (su && su.id);
      if (!sid) throw new Error('Keine SteamID gefunden – bitte deine SteamID64 eintragen.');
      const acc = loadAccounts();
      const n = (await scanSteamOwned({ steam: { api_key: key, steam_id: sid } })).length;
      acc.steam = { api_key: key, steam_id: sid }; saveAccounts(acc);
      return { ok: true, count: n };
    }
    case '/api/accounts/epic': {
      let code = String(b.code || '').trim();
      const m = code.match(/"authorizationCode"\s*:\s*"([^"]+)"/); if (m) code = m[1];
      if (!code) throw new Error('Bitte den Code einfügen.');
      let t;
      try { t = await epicToken({ grant_type: 'authorization_code', code }); } catch (e) { throw new Error('Epic-Anmeldung fehlgeschlagen: ' + e.message + ' – der Code ist nur kurz gültig, bitte erneut anmelden.'); }
      const acc = loadAccounts(); acc.epic = { refresh_token: t.refresh_token, name: t.displayName }; saveAccounts(acc);
      return { ok: true, name: t.displayName };
    }
    case '/api/accounts/gog': {
      let code = String(b.url || '').trim();
      const m = code.match(/[?&]code=([^&\s]+)/); if (m) code = decodeURIComponent(m[1]);
      if (!code) throw new Error('Bitte die Adresse einfügen.');
      let t;
      try { t = await gogToken({ grant_type: 'authorization_code', code, redirect_uri: GOG.redirect }); } catch (e) { throw new Error('GOG-Anmeldung fehlgeschlagen: ' + e.message); }
      const acc = loadAccounts(); acc.gog = { refresh_token: t.refresh_token }; saveAccounts(acc);
      gogAccess = { token: t.access_token, until: Date.now() + (t.expires_in || 3600) * 1000 };
      return { ok: true };
    }
    case '/api/accounts/itch': {
      const key = String(b.api_key || '').trim();
      if (!/^[\w-]{20,64}$/.test(key)) throw new Error('Das sieht nicht nach einem itch.io-API-Schlüssel aus.');
      const r = await fetch(`https://itch.io/api/1/${encodeURIComponent(key)}/me`, { headers: UA });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.errors || !j.user) throw new Error('itch.io hat den Schlüssel abgelehnt.');
      const acc = loadAccounts(); acc.itch = { api_key: key, name: j.user.username }; saveAccounts(acc);
      const n = (await scanItchOwned(acc)).length;
      return { ok: true, name: j.user.username, count: n };
    }
    case '/api/accounts/disconnect': {
      const acc = loadAccounts();
      if (!['steam', 'epic', 'gog', 'itch'].includes(b.store)) throw new Error('Unbekannter Store');
      delete acc[b.store]; saveAccounts(acc);
      const cache = loadCache(); delete cache[`_${b.store}Owned`]; saveCache(cache);
      return { ok: true };
    }
    case '/api/deals': {
      const d = await loadDeals(!!b.refresh);
      return { at: d.at, deals: markOwned(d.deals || []) };
    }
    case '/api/dealinfo': {
      // Spielinfos + Geräte-Schätzung für ein Angebot (über Steam-ID oder Namen)
      const cache = loadCache();
      const g = { name: String(b.title || ''), steamId: +b.steamId || null, gogId: +b.gogId || null };
      if (!g.name && !g.steamId) throw new Error('Kein Spiel angegeben');
      await enrich(g, cache, false);
      saveCache(cache);
      const devices = resolveDevices(loadConfig());
      const m = { ...g, min: rescoreReq(g.min), rec: rescoreReq(g.rec) };
      return { desc: g.desc, genres: g.genres, dev: g.dev, release: g.release, meta: g.meta, deck: g.deck, bg: g.bg, img: g.img, min: m.min, rec: m.rec, est: devices.map(d => estimate(m, d)) };
    }
    case '/api/favorite': {
      const key = String(b.key || '');
      if (!key) throw new Error('Kein Spiel angegeben');
      const favs = loadFavs();
      if (b.on) favs[key] = favs[key] || new Date().toISOString(); else delete favs[key];
      writeJson(FAV_FILE, favs, true);
      return { ok: true, fav: favs[key] || null };
    }
    case '/api/queue/add': {
      const keys = new Set((b.keys || []).map(String));
      const games = (library.games || []).filter(g => keys.has(gameKey(g)) && !g.installed);
      return { added: enqueue(games), items: publicQueue() };
    }
    case '/api/queue/action': {
      const it = queue.items.find(i => i.id === b.id);
      if (!it) throw new Error('Eintrag nicht gefunden');
      const active = activeCtl && activeCtl.id === it.id;
      if (b.action === 'pause') { if (active && it.status === 'lädt') { it.status = 'pausiert'; activeCtl.ctl.abort(); } else if (it.status === 'wartet') it.status = 'pausiert'; }
      else if (b.action === 'resume' || b.action === 'retry') { if (['pausiert', 'fehler', 'abgebrochen'].includes(it.status)) { it.status = 'wartet'; it.error = null; } pumpQueue(); }
      else if (b.action === 'cancel') {
        if (it.status === 'installiert gerade') throw new Error('Die Installation läuft gerade und kann nicht mehr abgebrochen werden.');
        it.status = 'abgebrochen'; if (active) activeCtl.ctl.abort();
        if (it.store === 'GOG' && it.dir) setTimeout(() => { try { fs.rmSync(it.dir, { recursive: true, force: true }); } catch {} }, 1500);
        it.done = 0; it.speed = 0;
      }
      else if (b.action === 'remove') { if (active) throw new Error('Erst pausieren oder abbrechen.'); queue.items = queue.items.filter(i => i !== it); }
      else if (b.action === 'top') { queue.items = [it, ...queue.items.filter(i => i !== it)]; }
      saveQueue(); queueChanged(true);
      return { items: publicQueue() };
    }
    case '/api/queue/clear': {
      queue.items = queue.items.filter(i => !['installiert', 'abgebrochen', 'heruntergeladen'].includes(i.status) && !/übergeben/.test(i.status));
      saveQueue(); queueChanged(true);
      return { items: publicQueue() };
    }
    case '/api/downloads/settings': {
      const cfg = loadConfig(); const cur = dlSettings();
      const dir = v => { const s = String(v || '').trim(); if (!s) return null; if (!path.isAbsolute(s)) throw new Error('Bitte einen vollständigen Ordnerpfad angeben (z. B. D:\\Spiele).'); return s; };
      cfg.downloads = {
        install_dir: dir(b.install_dir) || cur.install_dir,
        download_dir: dir(b.download_dir) || cur.download_dir,
        delete_installer: b.delete_installer !== undefined ? !!b.delete_installer : cur.delete_installer,
        auto_install: b.auto_install !== undefined ? !!b.auto_install : cur.auto_install,
      };
      saveConfig(cfg);
      return { settings: dlSettings(), free: { install: freeBytes(cfg.downloads.install_dir), download: freeBytes(cfg.downloads.download_dir) } };
    }
    case '/api/pickfolder': {
      // Windows-Ordnerauswahl (Dialog liegt über allen Fenstern)
      const t = String(b.title || 'Ordner wählen').replace(/'/g, "''");
      const start = String(b.start || '').replace(/'/g, "''");
      const cmd = `Add-Type -AssemblyName System.Windows.Forms; $o = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = '${t}'; $f.ShowNewFolderButton = $true; if ('${start}' -and (Test-Path '${start}')) { $f.SelectedPath = '${start}' }; if ($f.ShowDialog($o) -eq 'OK') { [Console]::OutputEncoding = [Text.Encoding]::UTF8; $f.SelectedPath }`;
      const out = await new Promise(res => { const p = spawn('powershell', ['-NoProfile', '-STA', '-Command', cmd], { windowsHide: true }); let o = ''; p.stdout.on('data', d => o += d); p.on('exit', () => res(o.trim())); p.on('error', () => res('')); });
      return { path: out || null };
    }
    case '/api/quit': setTimeout(shutdown, 200); return { ok: true };
  }
  const e = new Error('Nicht gefunden'); e.status = 404; throw e;
}

// ---------------------------------------------------------------------------
// Oberfläche (wird beim Bauen der exe eingebettet)
// ---------------------------------------------------------------------------
const EMBEDDED_UI = /*__UI__*/null;
const getUi = () => EMBEDDED_UI || fs.readFileSync(path.join(__dirname, 'ui.html'), 'utf8');

// ---------------------------------------------------------------------------
// Server + Fenster-Lebenszyklus
// ---------------------------------------------------------------------------
const TOKEN = (!IS_SEA && argVal('token')) || crypto.randomBytes(16).toString('hex');
let PORT = 0;
let idleTimer = null;
const STAY_ALIVE = NO_WINDOW;

function shutdown() {
  try { const l = readJson(LOCK_FILE, null); if (l && l.pid === process.pid) fs.unlinkSync(LOCK_FILE); } catch {}
  process.exit(0);
}
function armIdle(ms) {
  clearTimeout(idleTimer);
  if (STAY_ALIVE) return;
  // Laufende Downloads/Installationen halten die App im Hintergrund am Leben
  idleTimer = setTimeout(() => { if (clients.size === 0) { if (queueBusy()) armIdle(30000); else shutdown(); } }, ms);
}

const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host || '')) { res.writeHead(403); return res.end(); }
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(getUi());
  }
  if (!u.pathname.startsWith('/api/')) { res.writeHead(404); return res.end(); }
  if ((req.headers['x-token'] || u.searchParams.get('t')) !== TOKEN) return json(res, 401, { error: 'Nicht berechtigt' });
  if (u.pathname === '/api/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': verbunden\n\n');
    clients.add(res); clearTimeout(idleTimer);
    const ka = setInterval(() => { try { res.write(': ka\n\n'); } catch {} }, 20000);
    req.on('close', () => { clearInterval(ka); clients.delete(res); if (!clients.size) armIdle(15000); });
    return;
  }
  let body = {};
  if (req.method === 'POST') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch {}
  } else if (u.pathname !== '/api/state' && u.pathname !== '/api/ping') return json(res, 405, { error: 'POST erwartet' });
  try { json(res, 200, await route(u.pathname, body)); } catch (e) { json(res, e.status || 400, { error: e.message }); }
});

(async () => {
  // Läuft die App schon? Dann nur ein weiteres Fenster öffnen.
  const lock = readJson(LOCK_FILE, null);
  if (lock && lock.port && !NO_WINDOW) {
    try {
      const ac = new AbortController(); setTimeout(() => ac.abort(), 1500);
      const r = await fetch(`http://127.0.0.1:${lock.port}/api/ping`, { headers: { 'x-token': lock.token }, signal: ac.signal });
      if (r.ok) { openWindow(`http://127.0.0.1:${lock.port}/?t=${lock.token}`); return setTimeout(() => process.exit(0), 500); }
    } catch {}
  }
  const wantPort = +argVal('port') || 0;
  server.listen(wantPort, '127.0.0.1', () => {
    PORT = server.address().port;
    const url = `http://127.0.0.1:${PORT}/?t=${TOKEN}`;
    if (!NO_WINDOW) writeJson(LOCK_FILE, { port: PORT, token: TOKEN, pid: process.pid });
    log(`Spielebibliothek gestartet (Port ${PORT})`);
    if (!IS_SEA) console.log(url);
    if (!NO_WINDOW) { openWindow(url); armIdle(90000); }
  });
})();
