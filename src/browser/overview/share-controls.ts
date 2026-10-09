let nextInputId = 0;
const COPY_CONFIRMATION_DURATION_MS = 3000;

export function createShareControls(options: {
  root: HTMLElement;
  toolbar: HTMLElement;
  getLink: () => string | undefined;
  isCurrent: () => boolean;
}): { readonly button: HTMLButtonElement; isCurrent(): boolean; destroy(): void } {
  const { root, toolbar } = options;
  const document = root.ownerDocument;
  const view = document.defaultView;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hpm-overview__share';
  button.dataset.hpmShare = '';
  button.textContent = '分享地图';
  const status = document.createElement('span');
  status.className = 'hpm-overview__share-status';
  status.dataset.hpmShareStatus = '';
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('role', 'status');
  toolbar.append(button, status);
  let disposed = false;
  let attempt = 0;
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  let manual:
    | {
        box: HTMLDivElement;
        label: HTMLLabelElement;
        input: HTMLInputElement;
        close: HTMLButtonElement;
      }
    | undefined;
  function current() {
    return (
      !disposed &&
      options.isCurrent() &&
      toolbar.parentElement === root &&
      toolbar.querySelector('[data-hpm-share]') === button &&
      toolbar.querySelector('[data-hpm-share-status]') === status &&
      (!manual ||
        (root.querySelector('[data-hpm-share-manual]') === manual.box &&
          manual.box.parentElement === root &&
          manual.box.querySelector('label') === manual.label &&
          manual.box.querySelector('input') === manual.input &&
          manual.box.querySelector('[data-hpm-share-close]') === manual.close))
    );
  }
  function removeManual() {
    manual?.box.remove();
    manual = undefined;
  }
  function cancelStatusTimer() {
    if (statusTimer === undefined) return;
    clearTimeout(statusTimer);
    statusTimer = undefined;
  }
  function setStatus(message: string, durationMs?: number) {
    cancelStatusTimer();
    status.textContent = message;
    if (durationMs === undefined) return;
    const sequence = attempt;
    statusTimer = setTimeout(() => {
      statusTimer = undefined;
      if (current() && sequence === attempt) status.textContent = '';
    }, durationMs);
  }
  function pagehide() {
    attempt++;
    const hadConfirmation = statusTimer !== undefined;
    cancelStatusTimer();
    if (hadConfirmation && current()) status.textContent = '';
  }
  function closeManual() {
    if (!current()) return;
    attempt++;
    removeManual();
    setStatus('');
    button.focus({ preventScroll: true });
  }
  function fallback(link: string) {
    if (!current()) return;
    removeManual();
    const box = document.createElement('div');
    box.className = 'hpm-overview__share-manual';
    box.dataset.hpmShareManual = '';
    const label = document.createElement('label');
    label.textContent = '地图分享链接（请手动复制）';
    const input = document.createElement('input');
    input.type = 'text';
    input.readOnly = true;
    input.value = link;
    // Check the document as bundles may be re-evaluated while another root stays live.
    do {
      input.id = `hpm-share-link-${++nextInputId}`;
    } while (document.getElementById(input.id));
    label.htmlFor = input.id;
    const close = document.createElement('button');
    close.type = 'button';
    close.dataset.hpmShareClose = '';
    close.textContent = '关闭';
    close.addEventListener('click', closeManual);
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && current()) {
        event.preventDefault();
        event.stopPropagation();
        closeManual();
      }
    });
    box.append(label, input, close);
    manual = { box, label, input, close };
    root.append(box);
    setStatus('请手动复制链接');
    input.focus({ preventScroll: true });
    input.select();
  }
  function click() {
    if (!current()) return;
    const sequence = ++attempt;
    setStatus('');
    let link: string | undefined;
    try {
      link = options.getLink();
    } catch {
      /* A failed SDK read must not fail the map. */
    }
    if (!current()) return;
    if (!link) {
      removeManual();
      setStatus('暂时无法生成分享链接，请重试');
      return;
    }
    try {
      // Clipboard and writeText getters can throw; read them only in a user gesture.
      const clipboard = document.defaultView?.navigator.clipboard;
      const write = clipboard?.writeText;
      if (typeof write !== 'function') {
        fallback(link);
        return;
      }
      Promise.resolve(write.call(clipboard, link)).then(
        () => {
          if (!current() || sequence !== attempt) return;
          removeManual();
          setStatus('链接已复制', COPY_CONFIRMATION_DURATION_MS);
        },
        () => {
          if (current() && sequence === attempt) fallback(link!);
        },
      );
    } catch {
      if (current() && sequence === attempt) fallback(link);
    }
  }
  button.addEventListener('click', click);
  view?.addEventListener('pagehide', pagehide);
  return {
    button,
    isCurrent: current,
    destroy() {
      if (disposed) return;
      disposed = true;
      attempt++;
      cancelStatusTimer();
      view?.removeEventListener('pagehide', pagehide);
      button.removeEventListener('click', click);
      removeManual();
      root
        .querySelectorAll(':scope > [data-hpm-share-manual]')
        .forEach((element) => element.remove());
      button.remove();
      status.remove();
    },
  };
}
