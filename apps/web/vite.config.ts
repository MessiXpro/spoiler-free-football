import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * 构建完成后生成 service worker：预缓存页面外壳（HTML/JS/CSS/图标），
 * 数据文件运行时"网络优先、离线用缓存"。比分文件不预取。
 */
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'sff-service-worker',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    closeBundle() {
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
          const full = join(dir, name);
          if (statSync(full).isDirectory()) {
            if (name === 'data') continue;
            walk(full);
          } else if (name !== 'sw.js') {
            files.push(relative(outDir, full).split('\\').join('/'));
          }
        }
      };
      walk(outDir);
      const hash = createHash('sha256');
      for (const f of files.sort()) hash.update(f).update(readFileSync(join(outDir, f)));
      const template = readFileSync(join(__dirname, 'src', 'sw-template.js'), 'utf8');
      const sw = template
        .replace('__SFF_VERSION__', hash.digest('hex').slice(0, 12))
        .replace('__SFF_PRECACHE__', JSON.stringify(['./', ...files]));
      writeFileSync(join(outDir, 'sw.js'), sw);
    },
  };
}

export default defineConfig({
  // 相对路径：同一份构建产物既能放在 GitHub Pages 的子目录，也能放在 Cloudflare Pages 根目录
  base: './',
  // 不做 SPA 回退：找不到的文件返回 404（与 GitHub Pages / Cloudflare Pages 一致）
  appType: 'mpa',
  plugins: [react(), serviceWorker()],
  build: {
    target: 'es2022',
    sourcemap: false,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
