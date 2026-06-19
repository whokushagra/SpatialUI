import { defineConfig } from 'vite'
import os from 'os'

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

export default defineConfig({
  server: {
    port: 8000,
    host: true, // Listen on all interfaces so mobile devices can connect
    open: true
  },
  define: {
    __MAC_LAN_IP__: JSON.stringify(getLocalIp())
  }
})
