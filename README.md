# Void

**A designer-first platform for creating XR interfaces without code.**

Void is like Figma — but for spatial/XR apps. Design menus and UI screens visually, link them together, and eventually preview and deploy live to Meta Quest or Apple Vision Pro. No Unity expertise required.

---

## Getting Started

You need **Node.js** installed → [nodejs.org](https://nodejs.org) (download LTS)

```bash
# Install dependencies (first time only)
npm install

# Start the editor
npm run dev
```

Opens at **http://localhost:8000**

---

## Project Status

See [`PROJECT_STATUS.md`](./PROJECT_STATUS.md) for a plain-language breakdown of what's been built and what we're building next.

## Product Vision

See [`Void_ Designer-First XR UI Platform.pdf`](./Void_%20Designer-First%20XR%20UI%20Platform.pdf) for the full product overview, roadmap, and problem analysis.

## Phone Live Preview

1. `npm run dev` starts both the editor (port 8000) and the signaling Worker (port 8787).
2. For testing on a real phone, run `npm run dev:tunnel` to expose the editor over HTTPS via Cloudflare Tunnel.
3. In the editor, click the phone icon next to the camera icon. Scan the QR with your phone, enter the 4-digit PIN.
4. Phone shows live AR preview; desktop edits propagate within ~100 ms.

### Deploy

- `npm run deploy:worker` — push the signaling Worker.
- `npm run deploy:pages` — push the static site (editor + phone client).
- `npm run deploy` — both, in order.

Cloudflare account required; `wrangler login` once before first deploy.
