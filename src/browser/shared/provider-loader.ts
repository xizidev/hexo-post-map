import type { BrowserProviderConfig } from '../providers/types';

type ProviderFactory<TProvider> = (config: BrowserProviderConfig) => Promise<TProvider>;

export function createProviderLoader<TProvider>(
  factory: ProviderFactory<TProvider>,
): ProviderFactory<TProvider> {
  let pending: Promise<TProvider> | undefined;
  let identity: string | undefined;
  return (config: BrowserProviderConfig) => {
    const current = JSON.stringify([
      config.provider,
      config.amap.key,
      config.amap.mapStyle,
      config.amap.serviceHost,
      config.amap.securityJsCode,
    ]);
    if (pending) {
      return current === identity
        ? pending
        : Promise.reject(new Error('Conflicting map provider configuration'));
    }
    identity = current;
    pending = Promise.resolve()
      .then(() => factory(config))
      .catch((error: unknown) => {
        pending = undefined;
        identity = undefined;
        throw error;
      });
    return pending;
  };
}
