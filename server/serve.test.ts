import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAppServer } from './serve';

let dir: string;
let base: string;
const servers: ReturnType<typeof createAppServer>[] = [];

async function start(allowedIps?: string[]) {
  const server = createAppServer({ distDir: path.join(dir, 'dist'), dataDir: path.join(dir, 'data'), allowedIps });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'travel-serve-'));
  await mkdir(path.join(dir, 'dist', 'assets'), { recursive: true });
  await writeFile(path.join(dir, 'dist', 'index.html'), '<!doctype html><title>Travel log</title>');
  await writeFile(path.join(dir, 'dist', 'assets', 'index-abc.js'), 'console.log(1)');
  await writeFile(path.join(dir, 'secret.txt'), 'outside the build');
  base = await start();
});

afterAll(async () => {
  for (const s of servers) s.close();
  await rm(dir, { recursive: true, force: true });
});

describe('app server', () => {
  it('serves the build, with long caching only for hashed assets', async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect(await page.text()).toContain('Travel log');

    const script = await fetch(`${base}/assets/index-abc.js`);
    expect(script.headers.get('content-type')).toContain('text/javascript');
    expect(script.headers.get('cache-control')).toContain('immutable');
  });

  it('refuses files outside the build and unknown paths', async () => {
    // An encoded slash survives URL parsing and decodes to "/../secret.txt", a file that exists.
    expect((await fetch(`${base}/..%2fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${base}/assets/..%2f..%2fsecret.txt`)).status).toBe(404);
    expect((await fetch(`${base}/missing.js`)).status).toBe(404);
    expect((await fetch(`${base}/assets`)).status).toBe(404);
  });

  it('reads and saves the travel log', async () => {
    expect(await (await fetch(`${base}/api/data`)).json()).toBeNull();
    const data = { trips: [{ id: 'a', name: 'Munich', legs: [['HAM', 'MUC']] }] };
    const saved = await fetch(`${base}/api/data`, { method: 'PUT', body: JSON.stringify(data) });
    expect(saved.status).toBe(200);
    expect(await (await fetch(`${base}/api/data`)).json()).toEqual(data);
    expect(JSON.parse(await readFile(path.join(dir, 'data', 'travel.json'), 'utf8'))).toEqual(data);
  });

  it('only lets allowed clients in', async () => {
    const closed = await start(['172.30.32.2']);
    expect((await fetch(`${closed}/`)).status).toBe(403);
    expect((await fetch(`${closed}/api/data`)).status).toBe(403);
    const open = await start(['127.0.0.1']);
    expect((await fetch(`${open}/`)).status).toBe(200);
  });
});
