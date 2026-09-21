const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NAMESPACE, name);
}

export function createDetailMarker(sequence?: number): HTMLSpanElement {
  const marker = document.createElement('span');
  marker.className = 'hpm-detail-marker';
  marker.setAttribute('aria-hidden', 'true');

  const icon = svgElement('svg');
  icon.setAttribute('viewBox', '0 0 30 38');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');

  const shape = svgElement('path');
  shape.classList.add('hpm-detail-marker__shape');
  shape.setAttribute(
    'd',
    'M15 1C7.268 1 1 7.268 1 15c0 9.75 14 22 14 22s14-12.25 14-22C29 7.268 22.732 1 15 1Z',
  );
  icon.append(shape);

  if (sequence === undefined) {
    const dot = svgElement('circle');
    dot.classList.add('hpm-detail-marker__dot');
    dot.setAttribute('cx', '15');
    dot.setAttribute('cy', '15');
    dot.setAttribute('r', '5');
    icon.append(dot);
  } else {
    marker.classList.add('hpm-detail-marker--numbered');
    const label = svgElement('text');
    label.classList.add('hpm-detail-marker__label');
    label.setAttribute('x', '15');
    label.setAttribute('y', '15');
    label.textContent = String(sequence);
    icon.append(label);
  }

  marker.append(icon);
  return marker;
}
