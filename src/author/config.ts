import { ConfigValidationError, resolveConfig } from '../config/resolve';
import type { AuthorBootstrap } from './protocol';

const MANUAL_MESSAGE = '地图配置不可用；仍可手动编辑和导出。';
const SAFE_DIAGNOSTICS: Readonly<Record<string, string>> = {
  amap: 'amap：请提供完整地图配置。',
  'amap.key': 'amap.key：请提供有效 Key。',
  'amap.security': 'amap.security：必须且只能配置一种安全模式。',
  'amap.security.security_js_code': 'amap.security.security_js_code：请提供有效安全密钥。',
  'amap.security.service_host': 'amap.security.service_host：请提供不含内嵌凭据的 HTTPS 地址。',
  'amap.map_style': 'amap.map_style：请使用受支持的地图样式。',
  'post.default_zoom': 'post.default_zoom：请提供 2–20 的有限数值。',
};

/** Resolve author settings independently of the public publishing enablement switch. */
export function resolveAuthorBootstrap(raw: unknown, env: NodeJS.ProcessEnv): AuthorBootstrap {
  try {
    if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
      const resolved = resolveConfig({ ...structuredClone(raw), enabled: true }, env);
      if (resolved) {
        return {
          version: 1,
          mode: 'map',
          mapConfig: { provider: resolved.provider, amap: { ...resolved.amap } },
          defaultZoom: resolved.post.defaultZoom,
        };
      }
    }
  } catch (error) {
    // Resolver field paths can contain unknown user-provided names: never forward them.
    if (
      error instanceof ConfigValidationError &&
      Object.hasOwn(SAFE_DIAGNOSTICS, error.fieldPath)
    ) {
      return {
        version: 1,
        mode: 'manual',
        message: `${SAFE_DIAGNOSTICS[error.fieldPath]} ${MANUAL_MESSAGE}`,
      };
    }
  }
  return { version: 1, mode: 'manual', message: MANUAL_MESSAGE };
}
