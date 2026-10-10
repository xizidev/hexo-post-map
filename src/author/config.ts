import { resolveConfig } from '../config/resolve';
import type { AuthorBootstrap } from './protocol';

const MANUAL_MESSAGE = '地图配置不可用；仍可手动编辑和导出。';

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
  } catch {
    // Resolver field paths can contain unknown user-provided names: never forward them.
  }
  return { version: 1, mode: 'manual', message: MANUAL_MESSAGE };
}
