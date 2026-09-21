const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
let tooltipSequence = 0;

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NAMESPACE, name);
}

export interface DetailMarkerElement {
  readonly element: HTMLDivElement;
  readonly button: HTMLButtonElement;
  readonly tooltip: HTMLSpanElement;
  setExpanded(expanded: boolean): void;
  fitTooltip(container: HTMLElement): void;
}

const TOOLTIP_EDGE_GAP = 4;
const TOOLTIP_PIN_GAP = 6;

export function createDetailMarker(name: string, sequence?: number): DetailMarkerElement {
  const content = document.createElement('div');
  content.className = 'hpm-detail-marker-content';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'hpm-detail-marker';
  button.setAttribute(
    'aria-label',
    sequence === undefined ? `显示地点：${name}` : `显示地点 ${sequence}：${name}`,
  );
  button.setAttribute('aria-expanded', 'false');

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
    button.classList.add('hpm-detail-marker--numbered');
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

  button.append(icon);
  content.append(button, tooltip);
  return {
    element: content,
    button,
    tooltip,
    setExpanded(expanded) {
      button.setAttribute('aria-expanded', String(expanded));
      tooltip.hidden = !expanded;
      tooltip.scrollTop = 0;
      if (expanded) button.setAttribute('aria-describedby', tooltip.id);
      else {
        button.removeAttribute('aria-describedby');
        content.classList.remove('hpm-detail-marker-content--tooltip-below');
      }
    },
    fitTooltip(container) {
      if (tooltip.hidden) return;
      const bounds = container.getBoundingClientRect();
      const availableWidth = Math.max(1, bounds.width - TOOLTIP_EDGE_GAP * 2);
      tooltip.style.setProperty('--hpm-tooltip-max-width', `${availableWidth}px`);
      tooltip.style.removeProperty('--hpm-tooltip-max-height');
      tooltip.style.setProperty('--hpm-tooltip-shift-x', '0px');
      content.classList.remove('hpm-detail-marker-content--tooltip-below');

      const markerBounds = button.getBoundingClientRect();
      let tooltipBounds = tooltip.getBoundingClientRect();
      const top = bounds.top + TOOLTIP_EDGE_GAP;
      const bottom = bounds.bottom - TOOLTIP_EDGE_GAP;
      const availableAbove = Math.max(1, markerBounds.top - top - TOOLTIP_PIN_GAP);
      const availableBelow = Math.max(1, bottom - markerBounds.bottom - TOOLTIP_PIN_GAP);
      if (tooltipBounds.height > availableAbove && availableBelow > availableAbove) {
        content.classList.add('hpm-detail-marker-content--tooltip-below');
        tooltipBounds = tooltip.getBoundingClientRect();
      }
      const maxHeight = content.classList.contains('hpm-detail-marker-content--tooltip-below')
        ? availableBelow
        : availableAbove;
      tooltip.style.setProperty('--hpm-tooltip-max-height', `${maxHeight}px`);
      tooltipBounds = tooltip.getBoundingClientRect();

      const left = bounds.left + TOOLTIP_EDGE_GAP;
      const right = bounds.right - TOOLTIP_EDGE_GAP;
      const shiftX =
        tooltipBounds.left < left
          ? left - tooltipBounds.left
          : tooltipBounds.right > right
            ? right - tooltipBounds.right
            : 0;
      tooltip.style.setProperty('--hpm-tooltip-shift-x', `${shiftX}px`);
    },
  };
}
