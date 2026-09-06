import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API = process.env.VITE_API_TARGET || 'http://localhost:5178';

export default defineConfig({
  plugins: [react()],
  server: {
    // Bind the address explicitly, and the same one the data service binds.
    // Left to itself Vite follows whatever `localhost` resolves to, which here
    // is ::1 alone, and 127.0.0.1:5177 is then refused.
    host: '127.0.0.1',
    port: 5177,
    // Fail rather than fall forward. The next free port is 5178, where the data
    // service lives, and a client that lands there proxies /api to itself.
    strictPort: true,
    // The browser talks to one origin. The data service stays behind /api, so
    // nothing in the client needs to know where it runs.
    proxy: { '/api': { target: API, changeOrigin: true } },
  },
});
