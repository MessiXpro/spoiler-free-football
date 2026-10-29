/**
 * 包在整个用户脚本外面的兼容性检查（build.mjs 作为 esbuild 的 banner / footer 加上）。
 * 识别规则用了 RegExp 后行断言 (?<!…)，esbuild 按 safari15 目标会把它们改写成 new RegExp("…")，
 * 不支持的浏览器（Safari ≤ 16.3，即 iOS 15 / 16.0–16.3）里脚本一开头就抛错、什么都不做，页面上看不出任何异常；
 * String.prototype.at 同理（Chrome/WebView < 92、Safari < 15.4）。这里改成在页面底部明确提示浏览器太旧，
 * 而不是悄悄失效让人以为已经防住了。
 * 注意：构建目标不能提高到 safari16.4——那样 esbuild 会保留正则字面量，整个文件解析失败，任何检查都来不及运行。
 */
export const GUARD_JS =
  'if((function(){try{new RegExp("(?<!a)b");return typeof "".at==="function"}catch(e){return false}})()){';

export const FALLBACK_JS =
  '}else{(function(){var show=function(){try{var d=document.createElement("div");d.setAttribute("data-sff-ui","");' +
  'd.textContent="防剧透看球：浏览器版本太旧，脚本无法工作（需要 iOS/Safari 16.4、Chrome 92 或更新版本）";' +
  'd.style.cssText="position:fixed;left:0;right:0;bottom:0;z-index:2147483647;background:#b42318;color:#fff;font:14px/1.4 sans-serif;padding:8px 12px;text-align:center";' +
  '(document.body||document.documentElement).appendChild(d)}catch(e){}};' +
  'if(document.body)show();else document.addEventListener("DOMContentLoaded",show,{once:true});' +
  'console.warn("[防剧透看球] 浏览器太旧：不支持 RegExp lookbehind 或 String.prototype.at")})()}';
