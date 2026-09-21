// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { createDetailMarker } from '../../src/browser/detail/marker';

describe('detail marker DOM', () => {
  it('creates a focusable single-point pin with safely rendered tooltip text', () => {
    const marker = createDetailMarker('<img src=x onerror=alert(1)>');

    expect(marker.element.tagName).toBe('BUTTON');
    expect(marker.element.type).toBe('button');
    expect(marker.element.getAttribute('aria-label')).toBe(
      '显示地点：<img src=x onerror=alert(1)>',
    );
    expect(marker.element.getAttribute('aria-expanded')).toBe('false');
    expect(marker.element.hasAttribute('aria-describedby')).toBe(false);
    expect(marker.element.getAttribute('aria-hidden')).toBeNull();
    expect(marker.element.tabIndex).toBe(0);
    expect(marker.element.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(marker.element.querySelector('svg')?.getAttribute('focusable')).toBe('false');
    expect(marker.element.querySelector('.hpm-detail-marker__dot')).not.toBeNull();
    expect(marker.element.querySelector('.hpm-detail-marker__label')).toBeNull();
    expect(marker.tooltip.role).toBe('tooltip');
    expect(marker.tooltip.hidden).toBe(true);
    expect(marker.tooltip.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(marker.tooltip.querySelector('img')).toBeNull();
  });

  it('renders route sequence text and assigns every tooltip a unique relationship id', () => {
    const first = createDetailMarker('Visitor center', 1);
    const second = createDetailMarker('Visitor center', 2);

    expect(first.element.getAttribute('aria-label')).toBe('显示地点 1：Visitor center');
    expect(first.tooltip.textContent).toBe('1 · Visitor center');
    expect(first.element.querySelector('.hpm-detail-marker__label')?.textContent).toBe('1');
    expect(first.tooltip.id).toMatch(/^hpm-detail-tooltip-/u);
    expect(second.tooltip.id).toMatch(/^hpm-detail-tooltip-/u);
    expect(first.tooltip.id).not.toBe(second.tooltip.id);

    first.setExpanded(true);
    expect(first.element.getAttribute('aria-expanded')).toBe('true');
    expect(first.element.getAttribute('aria-describedby')).toBe(first.tooltip.id);
    expect(first.tooltip.hidden).toBe(false);
    first.setExpanded(false);
    expect(first.element.getAttribute('aria-expanded')).toBe('false');
    expect(first.element.hasAttribute('aria-describedby')).toBe(false);
    expect(first.tooltip.hidden).toBe(true);
  });
});
