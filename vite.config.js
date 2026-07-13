import { defineConfig } from 'vite'
import os from 'os'
import basicSsl from '@vitejs/plugin-basic-ssl'

function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

/**
 * Mobile-preview handoff. The desktop POSTs the full scene JSON here and gets back a
 * tiny id; the QR code only carries that id (e.g. ?pid=ab12cd34). This keeps the QR
 * small and scannable no matter how large the project is — the old approach stuffed
 * the entire base64 scene into the URL, which overflowed the QR for real templates.
 * The phone GETs the same endpoint (same Vite process) to load the scene.
 */
function voidPreviewHandoff() {
  const store = new Map();
  const order = [];
  return {
    name: 'void-preview-handoff',
    configureServer(server) {
      server.middlewares.use('/__void_preview', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', (c) => {
            body += c;
            if (body.length > 16_000_000) req.destroy();
          });
          req.on('end', () => {
            try {
              JSON.parse(body); // validate before storing
              const id = Math.random().toString(36).slice(2, 10);
              store.set(id, body);
              order.push(id);
              while (order.length > 40) store.delete(order.shift());
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ id }));
            } catch (e) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: 'invalid json' }));
            }
          });
          return;
        }
        if (req.method === 'GET') {
          const u = new URL(req.url, 'http://x');
          const id = u.searchParams.get('id');
          const data = id && store.get(id);
          res.setHeader('Access-Control-Allow-Origin', '*');
          if (!data) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'not found' }));
            return;
          }
          res.setHeader('Content-Type', 'application/json');
          res.end(data);
          return;
        }
        res.statusCode = 405;
        res.end();
      });
    }
  };
}

// VOID_NO_SSL=1 serves plain HTTP (used for local automated screenshots, which can't
// click through the self-signed-cert warning). The default stays HTTPS for the demo.
const NO_SSL = process.env.VOID_NO_SSL === '1';

export default defineConfig({
  // HTTPS (self-signed) is required so iOS Safari will grant camera access when a
  // phone opens the LAN URL from the QR code. getUserMedia only works in a secure
  // context (HTTPS / localhost) — a plain http://192.168.x.x URL silently fails on iOS.
  plugins: NO_SSL ? [voidPreviewHandoff()] : [basicSsl(), voidPreviewHandoff()],
  server: {
    port: 8000,
    host: true, // Listen on all interfaces so mobile devices can connect
    https: !NO_SSL,
    open: !NO_SSL
  },
  define: {
    __MAC_LAN_IP__: JSON.stringify(getLocalIp())
  }
})
