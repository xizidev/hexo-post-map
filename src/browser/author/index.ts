import { createAuthorDraft } from '../../author/draft';
import { readAuthorBootstrap, type AuthorBootstrap } from '../../author/protocol';
import { mountAuthorEditor, type AuthorEditorHandle, type AuthorEditorSession } from './controller';

const manual: AuthorBootstrap = {
  version: 1,
  mode: 'manual',
  message: '手动模式：地图配置暂不可用，可继续编辑并导出。',
};

export function startAuthorPage(owner: Window): { destroy(): void } {
  const root = owner.document.querySelector<HTMLElement>('[data-author-root]');
  if (!root) return { destroy() {} };
  const session: AuthorEditorSession = { draft: createAuthorDraft() };
  const token = /^#session=([A-Za-z0-9_-]{43})$/u.exec(owner.location.hash)?.[1];
  let alive = true;
  let visible = true;
  let generation = 0;
  let handle: AuthorEditorHandle | undefined;
  let abort = new AbortController();
  let bootstrap: AuthorBootstrap | undefined;
  async function mount(): Promise<void> {
    if (!alive || !visible || handle) return;
    const ticket = ++generation;
    const active = () => alive && visible && generation === ticket;
    if (!bootstrap) {
      let next = manual;
      if (token) {
        try {
          const response = await owner.fetch('/api/bootstrap', {
            headers: { 'X-HPM-Editor-Session': token },
            cache: 'no-store',
            credentials: 'omit',
            signal: abort.signal,
          });
          if (response.ok) next = readAuthorBootstrap(await response.json());
        } catch {
          /* Safe credential-free fallback, including rejected protocol payloads. */
        }
      }
      if (!active()) return;
      bootstrap = next;
    }
    if (active()) handle = mountAuthorEditor(root!, bootstrap, session);
  }
  function hide(): void {
    visible = false;
    generation += 1;
    abort.abort();
    handle?.destroy();
    handle = undefined;
  }
  function show(event: PageTransitionEvent): void {
    if (!alive || !event.persisted || visible) return;
    visible = true;
    abort = new AbortController();
    void mount();
  }
  owner.addEventListener('pagehide', hide);
  owner.addEventListener('pageshow', show);
  void mount();
  return {
    destroy() {
      if (!alive) return;
      alive = false;
      hide();
      owner.removeEventListener('pagehide', hide);
      owner.removeEventListener('pageshow', show);
    },
  };
}

if (typeof window !== 'undefined' && window.document.querySelector('[data-author-root]'))
  startAuthorPage(window);
