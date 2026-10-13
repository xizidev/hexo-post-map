type Field = 'name' | 'longitude' | 'latitude' | 'zoom';
export interface AuthorFieldFeedbackState {
  points: Map<string, Set<Field>>;
  candidate: Set<Field>;
  zoom: boolean;
}

/** Display timing is separate from the controller's immediate export guard. */
export function createAuthorFieldFeedback(
  root: HTMLElement,
  selectedId: () => string | undefined,
  errors: () => Record<Field, string>,
  restored?: AuthorFieldFeedbackState,
) {
  const state = restored ?? {
    points: new Map<string, Set<Field>>(),
    candidate: new Set<Field>(),
    zoom: false,
  };
  const removers: (() => void)[] = [];
  const focusOwners = new Map<Field, string | undefined>();
  const keys: Field[] = ['name', 'longitude', 'latitude', 'zoom'];
  const controls = Object.fromEntries(
    keys.map((key) => [
      key,
      root.querySelector<HTMLElement>(key === 'zoom' ? '[data-zoom]' : `[name=${key}]`)!,
    ]),
  ) as Record<Field, HTMLElement>;
  const messages = Object.fromEntries(
    keys.map((key) => [key, root.querySelector<HTMLElement>(`[data-${key}-error]`)!]),
  ) as Record<Field, HTMLElement>;
  let alive = true;
  let switching = false;
  function activeField(): Field | undefined {
    return keys.find((key) => root.ownerDocument.activeElement === controls[key]);
  }
  function bindActive(): void {
    const key = activeField();
    if (key) focusOwners.set(key, selectedId());
  }
  function touched(id: string | undefined): Set<Field> {
    if (!id) return state.candidate;
    let fields = state.points.get(id);
    if (!fields) state.points.set(id, (fields = new Set()));
    return fields;
  }
  function refresh(): void {
    if (!alive) return;
    const current = errors();
    const seen = touched(selectedId());
    for (const key of keys) {
      const message = (key === 'zoom' ? state.zoom : seen.has(key)) ? current[key] : '';
      messages[key].textContent = message;
      messages[key].hidden = !message;
      if (message) controls[key].setAttribute('aria-invalid', 'true');
      else controls[key].removeAttribute('aria-invalid');
    }
  }
  for (const key of keys) {
    const focus = () => {
      if (alive) focusOwners.set(key, selectedId());
    };
    const input = () => {
      if (!alive) return;
      focusOwners.set(key, selectedId());
      if (key === 'zoom') state.zoom = false;
      else touched(selectedId()).delete(key);
      messages[key].textContent = '';
      messages[key].hidden = true;
      controls[key].removeAttribute('aria-invalid');
    };
    const blur = () => {
      if (!alive) return;
      if (switching) {
        focusOwners.delete(key);
        return;
      }
      if (key === 'zoom') state.zoom = true;
      else touched(focusOwners.has(key) ? focusOwners.get(key) : selectedId()).add(key);
      focusOwners.delete(key);
      refresh();
    };
    controls[key].addEventListener('input', input);
    controls[key].addEventListener('focus', focus);
    controls[key].addEventListener('blur', blur);
    removers.push(() => {
      controls[key].removeEventListener('input', input);
      controls[key].removeEventListener('focus', focus);
      controls[key].removeEventListener('blur', blur);
    });
  }
  bindActive();
  return {
    refresh,
    changeContext(action: () => void) {
      if (!alive) return;
      // Switching can keep the same DOM field focused, so settle the old owner explicitly.
      const key = activeField();
      if (key === 'zoom') state.zoom = true;
      else if (key) touched(focusOwners.has(key) ? focusOwners.get(key) : selectedId()).add(key);
      switching = true;
      try {
        action();
      } finally {
        switching = false;
        focusOwners.clear();
        bindActive();
        refresh();
      }
    },
    submit() {
      for (const key of keys) touched(selectedId()).add(key);
      state.zoom = true;
      refresh();
      const current = errors();
      if (current.longitude || current.latitude || current.zoom)
        root.querySelector<HTMLDetailsElement>('[data-coordinate-details]')!.open = true;
    },
    resetCandidate() {
      state.candidate.clear();
    },
    forget(id: string) {
      state.points.delete(id);
    },
    reset() {
      state.points.clear();
      state.candidate.clear();
      state.zoom = false;
      focusOwners.clear();
    },
    snapshot(): AuthorFieldFeedbackState {
      return state;
    },
    destroy() {
      alive = false;
      removers.forEach((remove) => remove());
    },
  };
}
