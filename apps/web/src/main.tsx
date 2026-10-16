import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// 正式环境注册 service worker，支持离线打开和"添加到主屏幕"
if (
  import.meta.env.PROD &&
  'serviceWorker' in navigator &&
  !new URLSearchParams(location.search).has('nosw')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 本地文件打开等情况不支持，忽略 */
    });
  });
}
