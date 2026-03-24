// Descarga los archivos de FFmpeg.wasm necesarios para el editor
// Uso: node setup.js

const https = require('https');
const fs = require('fs');
const path = require('path');

const LIB_DIR = path.join(__dirname, 'lib');
if (!fs.existsSync(LIB_DIR)) fs.mkdirSync(LIB_DIR);

const FILES = [
  {
    url: 'https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.11.6/dist/ffmpeg.min.js',
    dest: 'lib/ffmpeg.min.js',
    desc: 'FFmpeg wrapper JS v0.11 (~100KB)',
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.js',
    dest: 'lib/ffmpeg-core.js',
    desc: 'FFmpeg core JS (~1MB)',
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.wasm',
    dest: 'lib/ffmpeg-core.wasm',
    desc: 'FFmpeg WASM (~22MB)',
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.11.0/dist/ffmpeg-core.worker.js',
    dest: 'lib/ffmpeg-core.worker.js',
    desc: 'FFmpeg core worker JS (~1MB)',
  },
];

function download(url, dest, desc) {
  return new Promise((resolve, reject) => {
    const destPath = path.join(__dirname, dest);
    if (fs.existsSync(destPath)) {
      console.log(`✓ ${desc} — ya existe, omitiendo`);
      return resolve();
    }

    console.log(`⬇ Descargando ${desc}...`);
    const file = fs.createWriteStream(destPath);

    function get(url) {
      https.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return get(res.headers.location);
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} para ${url}`));
          return;
        }
        const total = parseInt(res.headers['content-length'] || '0');
        let received = 0;
        res.on('data', chunk => {
          received += chunk.length;
          if (total) {
            const pct = Math.round(received / total * 100);
            process.stdout.write(`\r  ${pct}% (${(received/1024/1024).toFixed(1)}MB)`);
          }
        });
        res.pipe(file);
        file.on('finish', () => { file.close(); console.log(''); resolve(); });
      }).on('error', reject);
    }
    get(url);
  });
}

(async () => {
  console.log('Descargando archivos FFmpeg.wasm...\n');
  for (const f of FILES) {
    await download(f.url, f.dest, f.desc);
  }
  console.log('\n✅ Listo. Recarga la extensión en chrome://extensions');
})().catch(err => { console.error('Error:', err.message); process.exit(1); });
