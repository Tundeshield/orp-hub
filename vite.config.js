import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { output: { manualChunks: { firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'], react: ['react', 'react-dom', 'react-router-dom'] } } } },
  test: { environment: 'node', testTimeout: 30000, hookTimeout: 60000 },
});
