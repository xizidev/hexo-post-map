/** A fixed trusted pin; authored names are accessible text, never markup. */
export function createAuthorMarker(label: string, selected: boolean): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hpm-author-pin';
  button.setAttribute('aria-label', label);
  button.setAttribute('aria-pressed', String(selected));
  Object.assign(button.style, {
    width: '44px',
    height: '44px',
    padding: '6px',
    border: '0',
    borderRadius: '50%',
    background: selected ? 'Highlight' : 'Canvas',
    color: selected ? 'HighlightText' : 'CanvasText',
    cursor: 'pointer',
  });
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '32');
  svg.setAttribute('height', '32');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute(
    'd',
    'M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 4a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z',
  );
  path.setAttribute('fill', 'currentColor');
  svg.append(path);
  button.append(svg);
  return button;
}
