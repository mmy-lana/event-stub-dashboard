import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [
    angular(),
    tailwindcss()
  ],
  resolve: {
    mainFields: ['module']
  },
  server: {
    port: 3000,
    host: true
  }
});
