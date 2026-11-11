// Root `npm test`: every workspace's tests, each with its own settings (the client's include the
// obstacle drift guard that keeps shared/src/world/obstacles.ts in step with the client world).
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { projects: ['shared', 'server', 'client'] },
});
