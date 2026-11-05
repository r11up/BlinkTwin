import { defineConfig, type Plugin } from 'vite';

// Lets the desktop launcher's window shut the local server down (POST /api/quit). Dev server only.
const quit = (): Plugin => ({
  name: 'blinktwin-quit',
  configureServer(server) {
    server.middlewares.use('/api/quit', (req, res) => {
      if (req.method !== 'POST') {
        res.statusCode = 405;
        res.end();
        return;
      }
      res.end('bye');
      setTimeout(() => process.exit(0), 200);
    });
  },
});

export default defineConfig({ plugins: [quit()] });
