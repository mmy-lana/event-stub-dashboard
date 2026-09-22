import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import tailwindcss from '@tailwindcss/vite';

/**
 * Absolute path to the application TypeScript program.
 *
 * The Analog plugin type-checks and compiles components from this program, so it
 * must include `src/**` plus the Vite client typings used by
 * `import.meta.env`.
 */
const appTsconfigPath = fileURLToPath(new URL('./tsconfig.app.json', import.meta.url));

export default defineConfig({
  plugins: [
    angular({
      tsconfig: appTsconfigPath
    }),
    tailwindcss()
  ],
  resolve: {
    mainFields: ['module']
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200
  },
  server: {
    port: 3000,
    host: true
  }
});
