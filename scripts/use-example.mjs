#!/usr/bin/env node
// Copies data/travel.example.json to data/travel.json, so the app starts with example data.
// Never overwrites an existing travel log.

import { copyFile, constants } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

try {
  await copyFile(path.join(dataDir, 'travel.example.json'), path.join(dataDir, 'travel.json'), constants.COPYFILE_EXCL);
  console.log('Copied the example to data/travel.json. Run `npm start` to open it.');
} catch (err) {
  if (err.code !== 'EEXIST') throw err;
  console.error('data/travel.json already exists — not overwriting your travel log. Delete it first to use the example.');
  process.exit(1);
}
