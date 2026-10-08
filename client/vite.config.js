import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
  server: {
    fs: { allow: [join(root, '..')] },
  },
  build: {
    outDir: join(root, 'dist'),
    emptyOutDir: true,
  },
});
