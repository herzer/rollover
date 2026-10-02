import { defineConfig, type Plugin } from 'vite';
import { writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';

/** Dev only: lets the fur brush save its mask (POST /__dev/save?path=art/minka/…). Never in a build. */
function devSave(): Plugin {
  return {
    name: 'dev-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__dev/save', (req, res) => {
        const path = new URL(req.url ?? '', 'http://x').searchParams.get('path') ?? '';
        const target = resolve(server.config.root, path);
        if (req.method !== 'POST' || relative(resolve(server.config.root, 'art/minka'), target).startsWith('..')) {
          res.statusCode = 400; res.end('Only POSTs into art/minka/ are saved.'); return;
        }
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          try { JSON.parse(body); writeFileSync(target, body); res.end('ok'); }
          catch (e) { res.statusCode = 400; res.end(String(e)); }
        });
      });
    },
  };
}

export default defineConfig({ base: './', build: { target: 'es2022' }, plugins: [devSave()] });
