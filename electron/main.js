const { app, BrowserWindow, protocol, ipcMain, net } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.mp3':  'audio/mpeg',
  '.svg':  'image/svg+xml',
};

protocol.registerSchemesAsPrivileged([{
  scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
}]);

// Proxy activation requests through the main process to avoid CORS
ipcMain.handle('activate', async (_event, { serial, machineId }) => {
  const ACTIVATION_HOST = 'https://serial-activation.terricampoli25.workers.dev';
  try {
    const res = await net.fetch(`${ACTIVATION_HOST}/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serial, machineId }),
    });
    const data = await res.json();
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return { ok: false, status: 0, data: { error: e.message } };
  }
});

let win;

function createWindow() {
  win = new BrowserWindow({
    width: 480,
    height: 780,
    resizable: false,
    title: 'The Measure',
    icon: path.join(ROOT, 'icons', 'icon-512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  win.loadURL('app://the-measure/index.html');
  win.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const filePath = path.join(ROOT, url.pathname);
    const ext = path.extname(filePath);
    const mime = MIME[ext] ?? 'application/octet-stream';
    try {
      const stat = fs.statSync(filePath);
      const total = stat.size;
      const rangeHeader = request.headers.get('Range');
      if (rangeHeader) {
        const [, s, e] = /bytes=(\d+)-(\d*)/.exec(rangeHeader) || [];
        const start = parseInt(s) || 0;
        const end   = e ? parseInt(e) : total - 1;
        const chunk = end - start + 1;
        const buf   = Buffer.alloc(chunk);
        const fd    = fs.openSync(filePath, 'r');
        fs.readSync(fd, buf, 0, chunk, start);
        fs.closeSync(fd);
        return new Response(buf, {
          status: 206,
          headers: {
            'Content-Type': mime,
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunk),
          },
        });
      }
      const data = fs.readFileSync(filePath);
      return new Response(data, {
        headers: {
          'Content-Type': mime,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(total),
        },
      });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });

  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
