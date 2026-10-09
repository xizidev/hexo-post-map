// @vitest-environment happy-dom
import { Window } from 'happy-dom';
import { describe, expect, it, vi } from 'vitest';
import { createShareControls } from '../../src/browser/overview/share-controls';

const link = 'http://127.0.0.1:4000/blog/map/?hpm_v=1&hpm_center=121%2C31&hpm_zoom=11';
function fixture(getLink: () => string | undefined = () => link) {
  const owner = new Window({ url: 'http://127.0.0.1:4000/blog/map/' });
  const document = owner.document as unknown as Document;
  const root = document.createElement('section');
  const toolbar = document.createElement('div');
  root.append(toolbar);
  document.body.append(root);
  let current = true;
  const controls = createShareControls({ root, toolbar, getLink, isCurrent: () => current });
  return {
    owner,
    document,
    root,
    toolbar,
    controls,
    invalidate: () => {
      current = false;
    },
  };
}
async function settle() {
  await Promise.resolve();
  await Promise.resolve();
}
describe('share clipboard controls', () => {
  it('reads clipboard only on click and announces a successful write in its own live region', async () => {
    const f = fixture();
    const writeText = vi.fn().mockResolvedValue(undefined);
    const getter = vi.fn(() => ({ writeText }));
    Object.defineProperty(f.owner.navigator, 'clipboard', { get: getter });
    expect(getter).not.toHaveBeenCalled();
    expect(f.controls.button.textContent).toBe('分享地图');
    f.controls.button.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(link);
    expect(f.root.querySelector('[aria-live="polite"]')?.textContent).toBe('链接已复制');
    expect(f.root.querySelector('input')).toBeNull();
    f.controls.destroy();
  });
  it.each(['missing', 'clipboard-getter', 'write-getter', 'synchronous-write', 'rejection'])(
    'degrades %s to a root-local labeled readonly input',
    async (failure) => {
      const f = fixture();
      const execCommand = vi.fn();
      Object.defineProperty(f.document, 'execCommand', { value: execCommand });
      Object.defineProperty(f.owner.navigator, 'clipboard', {
        get() {
          if (failure === 'clipboard-getter') throw new Error('blocked');
          if (failure === 'missing') return undefined;
          return {
            get writeText() {
              if (failure === 'write-getter') throw new Error('blocked');
              return () => {
                if (failure === 'synchronous-write') throw new Error('blocked');
                return Promise.reject(new Error('blocked'));
              };
            },
          };
        },
      });
      f.controls.button.click();
      await settle();
      const input = f.root.querySelector('input')!;
      expect(input).not.toBeNull();
      expect(input.readOnly).toBe(true);
      expect(input.value).toBe(link);
      expect(f.root.querySelector('label')?.htmlFor).toBe(input.id);
      expect(f.document.activeElement).toBe(input);
      expect(execCommand).not.toHaveBeenCalled();
      expect(f.controls.isCurrent()).toBe(true);
      const focus = vi.spyOn(f.controls.button, 'focus');
      input.dispatchEvent(
        new f.owner.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event,
      );
      expect(f.root.querySelector('input')).toBeNull();
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
      f.controls.destroy();
    },
  );
  it('closes manual copy using its button and returns focus', () => {
    const f = fixture();
    Object.defineProperty(f.owner.navigator, 'clipboard', { value: undefined });
    f.controls.button.click();
    const close = f.root.querySelector<HTMLButtonElement>('[data-hpm-share-close]')!;
    expect(close).not.toBeNull();
    close.click();
    expect(f.document.activeElement).toBe(f.controls.button);
    expect(f.root.querySelector('input')).toBeNull();
  });
  it('contains link-generation failure locally without attempting a clipboard write', () => {
    const f = fixture(() => {
      throw new Error('provider unavailable');
    });
    const writeText = vi.fn();
    Object.defineProperty(f.owner.navigator, 'clipboard', { value: { writeText } });
    expect(() => f.controls.button.click()).not.toThrow();
    expect(writeText).not.toHaveBeenCalled();
    expect(f.root.querySelector('[aria-live]')?.textContent).toBeTruthy();
  });
  it('ignores an older rejection after a newer click has successfully copied its current link', async () => {
    let liveLink = link;
    const f = fixture(() => liveLink);
    let reject!: (error: Error) => void;
    let calls = 0;
    Object.defineProperty(f.owner.navigator, 'clipboard', {
      value: {
        writeText: () => {
          if (++calls === 1)
            return new Promise<void>((_, failed) => {
              reject = failed;
            });
          return Promise.resolve();
        },
      },
    });
    f.controls.button.click();
    liveLink = link.replace('hpm_zoom=11', 'hpm_zoom=12');
    f.controls.button.click();
    await settle();
    reject(new Error('old denial'));
    await settle();
    expect(f.root.querySelector('[aria-live]')?.textContent).toBe('链接已复制');
    expect(f.root.querySelector('input')).toBeNull();
  });
  it('ignores late successful writes after disposal', async () => {
    const f = fixture();
    let resolve!: () => void;
    Object.defineProperty(f.owner.navigator, 'clipboard', {
      value: {
        writeText: () =>
          new Promise<void>((done) => {
            resolve = done;
          }),
      },
    });
    f.controls.button.click();
    f.controls.destroy();
    resolve();
    await settle();
    expect(f.toolbar.children).toHaveLength(0);
    expect(f.root.querySelector('input')).toBeNull();
  });
  it.each(['destroy', 'replace', 'invalidate'])(
    'does not create UI after a late rejected write and %s',
    async (action) => {
      const f = fixture();
      let reject!: (error: Error) => void;
      Object.defineProperty(f.owner.navigator, 'clipboard', {
        value: {
          writeText: () =>
            new Promise<void>((_, failed) => {
              reject = failed;
            }),
        },
      });
      f.controls.button.click();
      if (action === 'destroy') f.controls.destroy();
      else if (action === 'replace')
        f.controls.button.replaceWith(f.controls.button.cloneNode(true));
      else f.invalidate();
      reject(new Error('denied'));
      await settle();
      expect(f.root.querySelector('input')).toBeNull();
      expect(f.controls.isCurrent()).toBe(false);
    },
  );
  it('detects replaced status and manual-copy nodes and keeps separate roots independent', () => {
    const f = fixture();
    const g = fixture();
    Object.defineProperty(f.owner.navigator, 'clipboard', { value: undefined });
    f.controls.button.click();
    f.root.querySelector('input')!.replaceWith(f.document.createElement('input'));
    expect(f.controls.isCurrent()).toBe(false);
    expect(g.controls.isCurrent()).toBe(true);
    g.root.querySelector('[aria-live]')!.remove();
    expect(g.controls.isCurrent()).toBe(false);
  });
});
