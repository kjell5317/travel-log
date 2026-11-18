import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDataHandler } from './dataApi.ts';

/**
 * The app without Vite: serves the production build (dist/) and the travel log API. Used by the Home Assistant
 * app (see Dockerfile) and `npm run serve`. Settings come from environment variables:
 *   PORT         port to listen on (default 5317)
 *   HOST         address to listen on (default 127.0.0.1, only this computer)
 *   DATA_DIR     folder of travel.json (default ./data)
 *   ALLOWED_IPS  comma-separated client addresses that may connect (default: any); Home Assistant's
 *                ingress proxy is 172.30.32.2
 */
export interface ServerOptions {
  distDir: string;
  dataDir: string;
  /** Client addresses that may connect; empty allows everyone. */
  allowedIps?: string[];
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function createAppServer({ distDir, dataDir, allowedIps = [] }: ServerOptions) {
  const root = path.resolve(distDir);
  const allowed = new Set(allowedIps);
  const api = createDataHandler(dataDir);

  return createServer((req, res) => {
    // IPv4 clients show up as "::ffff:1.2.3.4" when the server listens on IPv6 too.
    const client = req.socket.remoteAddress?.replace(/^::ffff:/, '') ?? '';
    if (allowed.size && !allowed.has(client)) return end(res, 403, 'Forbidden');
    api(req, res, () => serveFile(root, req, res).catch(() => end(res, 500, 'Internal error')));
  });
}

async function serveFile(root: string, req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return end(res, 405, 'Method not allowed');
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
  } catch {
    return end(res, 400, 'Bad request');
  }
  const file = path.join(root, pathname.endsWith('/') ? `${pathname}index.html` : pathname);
  // path.join resolves "..", so anything outside the build folder is refused.
  if (!file.startsWith(root + path.sep)) return end(res, 404, 'Not found');
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) return end(res, 404, 'Not found');

  res.writeHead(200, {
    'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    'Content-Length': info.size,
    // Built assets have a content hash in their name; index.html must be checked for a new build each time.
    'Cache-Control': file.startsWith(path.join(root, 'assets') + path.sep) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

function end(res: ServerResponse, status: number, text: string) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const projectDir = path.resolve(import.meta.dirname, '..');
  const port = Number(process.env.PORT) || 5317;
  const host = process.env.HOST || '127.0.0.1';
  const dataDir = path.resolve(process.env.DATA_DIR || path.join(projectDir, 'data'));
  const allowedIps = (process.env.ALLOWED_IPS ?? '')
    .split(',')
    .map((ip) => ip.trim())
    .filter(Boolean);
  const server = createAppServer({ distDir: path.join(projectDir, 'dist'), dataDir, allowedIps });
  server.listen(port, host, () => {
    console.log(`Travel log on http://${host}:${port} · data in ${dataDir}${allowedIps.length ? ` · only for ${allowedIps.join(', ')}` : ''}`);
  });
  // Docker and Home Assistant stop the app with SIGTERM. Saving writes a temporary file and renames it, so cutting
  // open connections can't leave a half-written travel.json.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      server.close(() => process.exit(0));
      server.closeAllConnections();
    });
  }
}
