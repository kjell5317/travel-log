import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';
import { travelDataApi } from './server/dataApi.ts';

const dataDir = path.resolve(import.meta.dirname, 'data');

export default defineConfig({
  plugins: [react(), travelDataApi(dataDir)],
  server: {
    port: 5317,
    // Only the travel log folder: saving trips must not reload the page, but src/data must still be watched.
    watch: { ignored: [`${dataDir}/**`] },
  },
  preview: { port: 5317 },
  // The bundled airport database and world shapes make one large chunk, and the city list (loaded on
  // demand) another; fine for a local app.
  build: { chunkSizeWarningLimit: 4000 },
});
