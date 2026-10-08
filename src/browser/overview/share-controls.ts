let nextInputId = 0;

export function createShareControls(options: {
  root: HTMLElement;
  toolbar: HTMLElement;
  getLink: () => string | undefined;
  isCurrent: () => boolean;
}): { readonly button: HTMLButtonElement; isCurrent(): boolean; destroy(): void } {
  const { root, toolbar } = options;
  const document = root.ownerDocument;
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
  function closeManual() {
    if (!current()) return;
    attempt++;
    removeManual();
    status.textContent = '';
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
    status.textContent = '请手动复制链接';
    input.focus({ preventScroll: true });
    input.select();
  }
  function click() {
    if (!current()) return;
    const sequence = ++attempt;
    let link: string | undefined;
    try {
      link = options.getLink();
    } catch {
      /* A failed SDK read must not fail the map. */
    }
    if (!current()) return;
    if (!link) {
      removeManual();
      status.textContent = '暂时无法生成分享链接，请重试';
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
          status.textContent = '链接已复制';
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
  return {
    button,
    isCurrent: current,
    destroy() {
      if (disposed) return;
      disposed = true;
      attempt++;
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
