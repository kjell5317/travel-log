import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Connect, Plugin } from 'vite';

/**
 * Serves the travel log stored in data/travel.json:
 *   GET /api/data  -> current file (or an empty log)
 *   PUT /api/data  -> replaces the file (previous version kept as travel.backup.json)
 */
export function travelDataApi(dataDir: string): Plugin {
  const file = path.join(dataDir, 'travel.json');
  const backup = path.join(dataDir, 'travel.backup.json');

  const handler: Connect.NextHandleFunction = async (req, res, next) => {
    if (req.url?.split('?')[0] !== '/api/data') return next();
    try {
      if (req.method === 'GET') {
        const body = await readFile(file, 'utf8').catch((err: NodeJS.ErrnoException) => {
          if (err.code === 'ENOENT') return 'null';
          throw err;
        });
        return send(res, 200, body);
      }
      if (req.method === 'PUT') {
        const data = JSON.parse(await readBody(req));
        if (!data || typeof data !== 'object' || !Array.isArray(data.trips)) {
          return send(res, 400, JSON.stringify({ error: 'Expected an object with a "trips" array' }));
        }
        await mkdir(dataDir, { recursive: true });
        await copyFile(file, backup).catch(() => {});
        const tmp = `${file}.tmp`;
        await writeFile(tmp, formatData(data));
        await rename(tmp, file);
        return send(res, 200, JSON.stringify({ ok: true }));
      }
      send(res, 405, JSON.stringify({ error: 'Method not allowed' }));
    } catch (err) {
      send(res, 500, JSON.stringify({ error: String(err) }));
    }
  };

  return {
    name: 'travel-data-api',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

function send(res: ServerResponse, status: number, body: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(body);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** Pretty-prints the data but keeps arrays of codes (legs, countries) on one line. */
export function formatData(data: unknown): string {
  return (
    JSON.stringify(data, null, 2).replace(/\[\s+("[A-Z0-9]{2,3}"(?:,\s+"[A-Z0-9]{2,3}")*)\s+\]/g, (_, items: string) =>
      `[${items.split(/,\s+/).join(', ')}]`,
    ) + '\n'
  );
}
