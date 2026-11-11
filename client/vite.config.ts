import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Builds index.html into ONE self-contained file (dist/index.html).
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2022', chunkSizeWarningLimit: 8000 },
});
