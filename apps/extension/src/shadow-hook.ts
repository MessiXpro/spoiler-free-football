import { installShadowHook } from '@sff/core/dom';

/**
 * 运行在页面主环境（world: MAIN）：让隔离环境的内容脚本能处理之后创建的 shadow root
 * （例如 B 站评论区 <bili-comments>）。只派发事件，不读取也不修改页面数据。
 */
installShadowHook(window);
