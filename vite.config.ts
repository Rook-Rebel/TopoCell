import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  server: { port: 5173, host: '127.0.0.1' },
  // three.js ერთ ფაილად იკვრება (~1 MB); გაფრთხილების ზღვარი შესაბამისად აწეულია
  build: { chunkSizeWarningLimit: 1500 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 120000,
  },
});
