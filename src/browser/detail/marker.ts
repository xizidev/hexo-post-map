const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
let tooltipSequence = 0;

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NAMESPACE, name);
}

export interface DetailMarkerElement {
  readonly element: HTMLButtonElement;
  readonly tooltip: HTMLSpanElement;
  setExpanded(expanded: boolean): void;
  fitTooltip(container: HTMLElement): void;
}

const TOOLTIP_EDGE_GAP = 4;

export function createDetailMarker(name: string, sequence?: number): DetailMarkerElement {
  const marker = document.createElement('button');
  marker.type = 'button';
  marker.className = 'hpm-detail-marker';
  marker.setAttribute(
    'aria-label',
    sequence === undefined ? `显示地点：${name}` : `显示地点 ${sequence}：${name}`,
  );
  marker.setAttribute('aria-expanded', 'false');

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

  const tooltip = document.createElement('span');
  tooltip.id = `hpm-detail-tooltip-${++tooltipSequence}`;
  tooltip.className = 'hpm-detail-marker__tooltip';
  tooltip.role = 'tooltip';
  tooltip.hidden = true;
  tooltip.textContent = sequence === undefined ? name : `${sequence} · ${name}`;

  marker.append(icon, tooltip);
  return {
    element: marker,
    tooltip,
    setExpanded(expanded) {
      marker.setAttribute('aria-expanded', String(expanded));
      tooltip.hidden = !expanded;
      if (expanded) marker.setAttribute('aria-describedby', tooltip.id);
      else marker.removeAttribute('aria-describedby');
    },
    fitTooltip(container) {
      if (tooltip.hidden) return;
      const bounds = container.getBoundingClientRect();
      const availableWidth = Math.max(1, bounds.width - TOOLTIP_EDGE_GAP * 2);
      const availableHeight = Math.max(1, bounds.height - TOOLTIP_EDGE_GAP * 2);
      tooltip.style.setProperty('--hpm-tooltip-max-width', `${availableWidth}px`);
      tooltip.style.setProperty('--hpm-tooltip-max-height', `${availableHeight}px`);
      tooltip.style.setProperty('--hpm-tooltip-shift-x', '0px');
      tooltip.style.setProperty('--hpm-tooltip-shift-y', '0px');
      marker.classList.remove('hpm-detail-marker--tooltip-below');

      const markerBounds = marker.getBoundingClientRect();
      let tooltipBounds = tooltip.getBoundingClientRect();
      const top = bounds.top + TOOLTIP_EDGE_GAP;
      const bottom = bounds.bottom - TOOLTIP_EDGE_GAP;
      const availableAbove = markerBounds.top - top;
      const availableBelow = bottom - markerBounds.bottom;
      if (tooltipBounds.height > availableAbove && availableBelow > availableAbove) {
        marker.classList.add('hpm-detail-marker--tooltip-below');
        tooltipBounds = tooltip.getBoundingClientRect();
      }

      const left = bounds.left + TOOLTIP_EDGE_GAP;
      const right = bounds.right - TOOLTIP_EDGE_GAP;
      const shiftX =
        tooltipBounds.left < left
          ? left - tooltipBounds.left
          : tooltipBounds.right > right
            ? right - tooltipBounds.right
            : 0;
      const shiftY =
        tooltipBounds.top < top
          ? top - tooltipBounds.top
          : tooltipBounds.bottom > bottom
            ? bottom - tooltipBounds.bottom
            : 0;
      tooltip.style.setProperty('--hpm-tooltip-shift-x', `${shiftX}px`);
      tooltip.style.setProperty('--hpm-tooltip-shift-y', `${shiftY}px`);
    },
  };
}
