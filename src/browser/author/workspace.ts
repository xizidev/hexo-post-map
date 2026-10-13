const placeControls = [
  '[data-select]',
  '[data-route-add]',
  '[data-up]',
  '[data-down]',
  '[data-delete]',
  'input[name=representative]',
  '.place-more > summary',
] as const;
const routeControls = ['[data-up]', '[data-down]', '[data-remove]'] as const;
const fixedControls = [
  '[data-workspace-tab=places]',
  '[data-workspace-tab=route]',
  '[name=name]',
  '[name=longitude]',
  '[name=latitude]',
  '[data-zoom]',
  '[data-coordinate-details] > summary',
  '[data-new]',
  '[data-import-open]',
  '[data-add]',
  '[data-copy]',
  '[data-download]',
] as const;
type WorkspaceFocus =
  | { kind: 'place'; id: string; control: (typeof placeControls)[number] }
  | { kind: 'route'; id: string; index: string; control: (typeof routeControls)[number] }
  | { kind: 'fixed'; control: (typeof fixedControls)[number] };

export interface AuthorWorkspaceState {
  tab: 'places' | 'route';
  coordinatesOpen: boolean;
  focus?: WorkspaceFocus;
  scrollTop?: number;
}

/** Own only page-local tab visibility and keyboard focus, never draft data. */
export function createAuthorWorkspace(root: HTMLElement, restored?: AuthorWorkspaceState) {
  function find<T extends HTMLElement>(selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error('Author workspace markup is incomplete.');
    return element;
  }
  const tabs = {
    places: find<HTMLButtonElement>('[data-workspace-tab=places]'),
    route: find<HTMLButtonElement>('[data-workspace-tab=route]'),
  };
  const panels = {
    places: find('[data-workspace-panel=places]'),
    route: find('[data-workspace-panel=route]'),
  };
  const coordinates = find<HTMLDetailsElement>('[data-coordinate-details]');
  const editor = find('[data-editor-scroll]');
  let active: AuthorWorkspaceState['tab'] = restored?.tab === 'route' ? 'route' : 'places';
  let alive = true;
  const removers: (() => void)[] = [];
  coordinates.open = restored?.coordinatesOpen === true;

  function show(
    tab: AuthorWorkspaceState['tab'],
    options?: { coordinates?: boolean; focus?: boolean },
  ): void {
    if (!alive) return;
    const previous = root.ownerDocument.activeElement;
    const hidingFocused = tab !== active && !!previous && panels[active].contains(previous);
    active = tab;
    for (const key of ['places', 'route'] as const) {
      tabs[key].setAttribute('aria-selected', String(key === tab));
      tabs[key].tabIndex = key === tab ? 0 : -1;
      panels[key].hidden = key !== tab;
    }
    if (options?.coordinates !== undefined) coordinates.open = options.coordinates;
    if (options?.focus || hidingFocused) tabs[tab].focus({ preventScroll: true });
  }
  for (const key of ['places', 'route'] as const) {
    const click = () => show(key);
    const keydown = (event: KeyboardEvent) => {
      const target =
        event.key === 'Home'
          ? 'places'
          : event.key === 'End'
            ? 'route'
            : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
              ? key === 'places'
                ? 'route'
                : 'places'
              : undefined;
      if (!target) return;
      event.preventDefault();
      show(target, { focus: true });
    };
    tabs[key].addEventListener('click', click);
    tabs[key].addEventListener('keydown', keydown);
    removers.push(() => {
      tabs[key].removeEventListener('click', click);
      tabs[key].removeEventListener('keydown', keydown);
    });
  }
  show(active);

  function reveal(element: HTMLElement): void {
    if (!alive || !editor.contains(element)) return;
    const viewport = editor.getBoundingClientRect();
    if (viewport.height <= 0) return;
    const bounds = element.getBoundingClientRect();
    // Leave room for the focus outline and round outwards at fractional pixel edges.
    const top = viewport.top + 8;
    const bottom = viewport.bottom - 8;
    if (bounds.top < top) editor.scrollTop += Math.floor(bounds.top - top);
    else if (bounds.bottom > bottom) editor.scrollTop += Math.ceil(bounds.bottom - bottom);
  }

  function focusedControl(): WorkspaceFocus | undefined {
    const element = root.ownerDocument.activeElement;
    if (!(element instanceof root.ownerDocument.defaultView!.HTMLElement)) return;
    const place = element.closest<HTMLElement>('[data-point-id]');
    if (place && root.contains(place)) {
      const control = placeControls.find((selector) => element.matches(selector));
      if (control) return { kind: 'place', id: place.dataset.pointId!, control };
    }
    const route = element.closest<HTMLElement>('[data-route-index]');
    if (route && root.contains(route)) {
      const control = routeControls.find((selector) => element.matches(selector));
      if (control)
        return {
          kind: 'route',
          id: route.dataset.routeId!,
          index: route.dataset.routeIndex!,
          control,
        };
    }
    const control = fixedControls.find((selector) => element.matches(selector));
    if (control && root.contains(element)) return { kind: 'fixed', control };
  }

  return {
    show,
    reveal,
    counts(places: number, stops: number): void {
      if (!alive) return;
      find('[data-place-count]').textContent = String(places);
      find('[data-route-count]').textContent = `${stops}站`;
      find('[data-editor-count]').textContent = `${places} 个地点 · ${stops} 次途经`;
      find('[data-empty-places]').hidden = places !== 0;
      find('[data-empty-route]').hidden = stops !== 0;
    },
    snapshot(): AuthorWorkspaceState {
      return {
        tab: active,
        coordinatesOpen: coordinates.open,
        focus: focusedControl(),
        scrollTop: editor.scrollTop,
      };
    },
    restoreFocus(): void {
      if (!alive || !restored) return;
      const previous = root.ownerDocument.activeElement;
      // A user who moved outside this editor while it was suspended keeps ownership.
      if (previous && previous !== root.ownerDocument.body && !root.contains(previous)) return;
      const focus = restored.focus;
      if (!focus) {
        if (restored.scrollTop !== undefined) editor.scrollTop = restored.scrollTop;
        return;
      }
      const row =
        focus.kind === 'place'
          ? [...root.querySelectorAll<HTMLElement>('[data-point-id]')].find(
              (item) => item.dataset.pointId === focus.id,
            )
          : focus.kind === 'route'
            ? [...root.querySelectorAll<HTMLElement>('[data-route-index]')].find(
                (item) =>
                  item.dataset.routeIndex === focus.index && item.dataset.routeId === focus.id,
              )
            : root;
      let target = row?.querySelector<HTMLElement>(focus.control);
      if (target?.matches(':disabled'))
        target = focus.kind === 'place' ? row?.querySelector('[data-select]') : undefined;
      if (!target || target.closest('[hidden]')) target = tabs[active];
      // Recreated cards start collapsed. A restored action must be visible to its user.
      for (
        let parent = target.parentElement;
        parent && parent !== root;
        parent = parent.parentElement
      )
        if (parent instanceof root.ownerDocument.defaultView!.HTMLDetailsElement) {
          const summary = [...parent.children].find((child) => child.tagName === 'SUMMARY');
          if (!summary?.contains(target)) parent.open = true;
        }
      if (restored.scrollTop !== undefined) editor.scrollTop = restored.scrollTop;
      target.focus({ preventScroll: true });
      reveal(target);
    },
    destroy(): void {
      if (!alive) return;
      alive = false;
      removers.forEach((remove) => remove());
    },
  };
}
