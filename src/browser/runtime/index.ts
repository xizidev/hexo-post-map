import { installBrowserRuntime } from './runtime';

const script = document.currentScript;
if (script instanceof HTMLScriptElement) {
  installBrowserRuntime(script);
} else {
  console.warn('HexoPostMap: runtime script element is unavailable.');
}
