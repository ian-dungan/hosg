import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/** The online page is the site's front page: emit online.html as index.html. */
const onlineAsIndex = (): Plugin => ({
  name: 'sg2-online-as-index',
  enforce: 'post',
  generateBundle(_options, bundle) {
    const page = bundle['online.html'];
    if (page) page.fileName = 'index.html';
  },
});

export default defineConfig(({ mode }) => {
  if (mode === 'online') {
    // The online client: a normal multi-file build into dist-online/, served by the game server.
    // In development (`npm run dev:online`) /api goes to the game server at SG2_SERVER
    // (default http://localhost:2570); open /online.html?server=http://localhost:2570 so the room
    // connection goes there too.
    return {
      build: {
        target: 'es2022',
        outDir: 'dist-online',
        chunkSizeWarningLimit: 8000,
        rollupOptions: { input: 'online.html' },
      },
      plugins: [onlineAsIndex()],
      server: { proxy: { '/api': process.env.SG2_SERVER ?? 'http://localhost:2570' } },
    };
  }
  // Builds index.html into ONE self-contained file (dist/index.html).
  return {
    plugins: [viteSingleFile()],
    build: { target: 'es2022', chunkSizeWarningLimit: 8000 },
  };
});
