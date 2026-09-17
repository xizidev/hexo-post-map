export function setStatus(root: HTMLElement, message: string): void {
  const status = root.querySelector<HTMLElement>('[data-hpm-status]');
  if (status) status.textContent = message;
}

export function showFallback(root: HTMLElement, visible: boolean): void {
  const fallback = root.querySelector<HTMLElement>('[data-hpm-fallback]');
  if (fallback) fallback.hidden = !visible;
}
