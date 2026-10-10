import {
  addAuthorPoint,
  createAuthorDraft,
  deleteAuthorPoint,
  moveAuthorPoint,
  selectAuthorRepresentative,
  setAuthorRoute,
  setAuthorZoom,
  updateAuthorPoint,
} from '../../author/draft';
import type { AuthorBootstrap } from '../../author/protocol';
import type { AuthorDraft, AuthorMapInput } from '../../author/types';
import { exportAuthorYaml, importAuthorYaml } from '../../author/yaml';
import type { Coordinate } from '../../domain/types';
import { createAuthorExportControls } from './export-controls';
import { createAuthorMap, type AuthorMapHandle } from './map';
import { createAuthorView } from './view';

export interface AuthorEditorSession {
  draft: AuthorDraft;
  selectedId?: string;
}
export interface AuthorEditorHandle {
  destroy(): void;
}
type Fields = { name: string; longitude: string; latitude: string };

function numberInput(value: string, bound: number): number | undefined {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/iu.test(value.trim())) return;
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= bound ? number : undefined;
}
function complete(fields: Fields): boolean {
  return (
    !!fields.name.trim() &&
    numberInput(fields.longitude, 180) !== undefined &&
    numberInput(fields.latitude, 90) !== undefined
  );
}

/** Own UI mutations and resources; the caller owns only the in-memory session. */
export function mountAuthorEditor(
  root: HTMLElement,
  bootstrap: AuthorBootstrap,
  session: AuthorEditorSession,
  options?: { mapFactory?: typeof createAuthorMap },
): AuthorEditorHandle {
  const view = createAuthorView(root);
  const document = root.ownerDocument;
  const owner = document.defaultView!;
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const fields = {
    name: find<HTMLTextAreaElement>('[name=name]'),
    longitude: find<HTMLInputElement>('[name=longitude]'),
    latitude: find<HTMLInputElement>('[name=latitude]'),
  };
  const zoom = find<HTMLInputElement>('[data-zoom]');
  const buffers = new Map<string, Fields>();
  const invalidPoints = new Set<string>();
  const pointRows = new Map<string, HTMLElement>();
  const routeRows: HTMLElement[] = [];
  const routeReferences = new Map<string, number[]>();
  const removers: (() => void)[] = [];
  let alive = true;
  let generation = 0;
  let queued = false;
  let newDirty = false;
  let zoomInvalid = false;
  let map: AuthorMapHandle | undefined;
  let mapAbort = new AbortController();
  let candidate: Coordinate | undefined;
  let imported: AuthorMapInput | undefined;
  let deleteId: string | undefined;
  let returnFocus: HTMLElement | undefined;
  const values = (): Fields => ({
    name: fields.name.value,
    longitude: fields.longitude.value,
    latitude: fields.latitude.value,
  });
  const pending = () =>
    zoomInvalid ||
    invalidPoints.size > 0 ||
    (!session.selectedId && newDirty && !complete(values()));
  let exports = createAuthorExportControls(
    view.export,
    () => exportAuthorYaml(session.draft),
    pending,
  );
  function on(target: EventTarget, event: string, action: EventListener): void {
    target.addEventListener(event, action);
    removers.push(() => target.removeEventListener(event, action));
  }
  function safe(action: () => void): void {
    if (!alive) return;
    try {
      action();
    } catch {
      view.status.textContent = '操作无法完成，请检查字段或数量限制。';
    }
  }
  function schedule(): void {
    if (!alive || queued) return;
    queued = true;
    const ticket = generation;
    queueMicrotask(() => {
      if (!alive || ticket !== generation) return;
      queued = false;
      exports.refresh();
      view.status.textContent = pending()
        ? '名称、坐标或缩放尚未完成，请检查输入。'
        : session.draft.representativeMode === 'pending'
          ? '请明确选择新的代表地点。'
          : session.draft.route.length === 1
            ? '线路至少需要两个途经项。'
            : '';
      find('[data-field-error]').textContent = session.selectedId
        ? buffers.has(session.selectedId) && !complete(values())
          ? '请输入非空名称及完整有限坐标（经度 ±180、纬度 ±90）。'
          : ''
        : newDirty && !complete(values())
          ? '请输入非空名称及完整有限坐标（经度 ±180、纬度 ±90）。'
          : '';
      map?.render(session.draft, session.selectedId);
    });
  }
  function disablePending(): void {
    if (!pending()) return;
    find<HTMLButtonElement>('[data-copy]').disabled = true;
    find<HTMLButtonElement>('[data-download]').disabled = true;
    find('[data-yaml]').textContent = '预览已过期，请完成有效草稿后导出。';
  }
  function showFields(): void {
    const point = session.draft.points.find((point) => point.id === session.selectedId);
    if (!point) session.selectedId = undefined;
    const value = point
      ? (buffers.get(point.id) ?? {
          name: point.name,
          longitude: String(point.longitude),
          latitude: String(point.latitude),
        })
      : {
          name: '',
          longitude: candidate ? String(candidate[0]) : '',
          latitude: candidate ? String(candidate[1]) : '',
        };
    for (const key of ['name', 'longitude', 'latitude'] as const) fields[key].value = value[key];
    find('[data-form-title]').textContent = point
      ? `编辑地点 ${point.id}`
      : candidate
        ? '确认候选地点'
        : '新增地点';
    find<HTMLButtonElement>('[data-add]').hidden = !!point;
    find('[data-field-error]').textContent = '';
  }
  function button(text: string, attribute: string): HTMLButtonElement {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = text;
    item.setAttribute(attribute, '');
    return item;
  }
  function updateRow(id: string): void {
    const row = pointRows.get(id);
    const point = session.draft.points.find((point) => point.id === id);
    if (!row || !point) return;
    row.querySelector('[data-select]')!.textContent = point.name || '未命名地点';
    row.setAttribute('aria-current', String(session.selectedId === id));
    row.querySelector<HTMLInputElement>('input')!.checked = session.draft.representativeId === id;
    // Route names update without removing the current row or shifting focus.
    routeReferences.get(id)?.forEach((index) => {
      routeRows[index]!.querySelector('span')!.textContent = `${index + 1}. ${point.name}`;
    });
  }
  function syncPoints(): void {
    const focused = document.activeElement as HTMLElement | null;
    const focusRow = focused?.closest<HTMLElement>('[data-point-id]');
    const wanted = new Set(session.draft.points.map((point) => point.id));
    for (const [id, row] of pointRows)
      if (!wanted.has(id)) {
        row.remove();
        pointRows.delete(id);
      }
    session.draft.points.forEach((point, index) => {
      let row = pointRows.get(point.id);
      if (!row) {
        row = document.createElement('li');
        row.dataset.pointId = point.id;
        const select = button('', 'data-select');
        const label = document.createElement('label');
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'representative';
        radio.value = point.id;
        label.append(radio, document.createTextNode('代表地点'));
        const actions = document.createElement('div');
        actions.className = 'actions';
        const route = button('加入线路', 'data-route-add');
        route.dataset.routeAdd = point.id;
        actions.append(
          button('上移', 'data-up'),
          button('下移', 'data-down'),
          route,
          button('删除', 'data-delete'),
        );
        row.append(select, label, actions);
        pointRows.set(point.id, row);
      }
      if (view.pointList.children[index] !== row)
        view.pointList.insertBefore(row, view.pointList.children[index] ?? null);
      row.querySelector<HTMLButtonElement>('[data-up]')!.disabled = index === 0;
      row.querySelector<HTMLButtonElement>('[data-down]')!.disabled =
        index === session.draft.points.length - 1;
      updateRow(point.id);
    });
    if (focusRow?.isConnected && focused?.isConnected && document.activeElement !== focused) {
      const target =
        focused instanceof owner.HTMLButtonElement && focused.disabled
          ? focusRow.querySelector<HTMLButtonElement>('[data-select]')!
          : focused;
      target.focus({ preventScroll: true });
    }
  }
  function syncRoute(): void {
    routeReferences.clear();
    while (routeRows.length > session.draft.route.length) routeRows.pop()!.remove();
    session.draft.route.forEach((id, index) => {
      const references = routeReferences.get(id) ?? [];
      references.push(index);
      routeReferences.set(id, references);
      let row = routeRows[index];
      if (!row) {
        row = document.createElement('li');
        const text = document.createElement('span');
        const actions = document.createElement('div');
        actions.className = 'actions';
        actions.append(
          button('上移', 'data-up'),
          button('下移', 'data-down'),
          button('移除途经项', 'data-remove'),
        );
        row.append(text, actions);
        routeRows.push(row);
        view.routeList.append(row);
      }
      row.dataset.routeIndex = String(index);
      row.querySelector('span')!.textContent =
        `${index + 1}. ${session.draft.points.find((point) => point.id === id)!.name}`;
      row.querySelector<HTMLButtonElement>('[data-up]')!.disabled = index === 0;
      row.querySelector<HTMLButtonElement>('[data-down]')!.disabled =
        index === session.draft.route.length - 1;
    });
  }
  function select(id?: string): void {
    const before = session.selectedId;
    session.selectedId = id;
    candidate = undefined;
    map?.setCandidate(undefined);
    newDirty = false;
    showFields();
    if (before) updateRow(before);
    if (id) updateRow(id);
    disablePending();
    schedule();
  }
  function startMap(): void {
    if (bootstrap.mode === 'manual') {
      find('[data-map-status]').textContent = bootstrap.message;
      return;
    }
    const ticket = generation;
    const active = () => alive && ticket === generation && !mapAbort.signal.aborted;
    void (options?.mapFactory ?? createAuthorMap)(view.map, {
      config: bootstrap.mapConfig,
      defaultZoom: bootstrap.defaultZoom,
      signal: mapAbort.signal,
      onCandidate(coordinate) {
        if (!active()) return;
        select();
        candidate = coordinate;
        newDirty = true;
        showFields();
        map?.setCandidate(coordinate);
        disablePending();
        schedule();
      },
      onSelect(id) {
        if (active() && session.draft.points.some((point) => point.id === id)) select(id);
      },
      onMove(id, coordinate) {
        if (!active() || id !== session.selectedId) return;
        safe(() => {
          session.draft = updateAuthorPoint(session.draft, id, {
            longitude: coordinate[0],
            latitude: coordinate[1],
          });
          const previous = buffers.get(id);
          if (previous)
            buffers.set(id, {
              ...previous,
              longitude: String(coordinate[0]),
              latitude: String(coordinate[1]),
            });
          if (previous && complete(buffers.get(id)!)) invalidPoints.delete(id);
          showFields();
          updateRow(id);
          schedule();
        });
      },
      onWarning(message) {
        if (active()) find('[data-map-status]').textContent = message;
      },
    })
      .then((handle) => {
        if (!active()) {
          handle.destroy();
          return;
        }
        map = handle;
        map.render(session.draft, session.selectedId);
        if (candidate) map.setCandidate(candidate);
      })
      .catch(() => {
        if (active()) find('[data-map-status]').textContent = '地图预览暂不可用，请继续手动编辑。';
      });
  }
  function metadata(): void {
    zoom.value = session.draft.zoom === undefined ? '' : String(session.draft.zoom);
    zoomWarning();
    const track = find('[data-track]');
    track.hidden = session.draft.track === undefined;
    track.textContent = session.draft.track
      ? `真实轨迹配置已保留，选点助手仅预览地点和示意线。只读配置：${JSON.stringify(session.draft.track)}。导出后请核对目标文章的相对路径。`
      : '';
  }
  function zoomWarning(): void {
    find('[data-zoom-warning]').textContent =
      session.draft.zoom !== undefined && (session.draft.zoom < 2 || session.draft.zoom > 20)
        ? '导入缩放已保留；地图预览仅支持 2–20。'
        : '';
  }
  function open(dialog: HTMLDialogElement): void {
    returnFocus =
      document.activeElement instanceof owner.HTMLElement
        ? (document.activeElement as HTMLElement)
        : undefined;
    dialog.showModal();
  }
  function close(dialog: HTMLDialogElement): void {
    dialog.close();
    if (returnFocus?.isConnected) returnFocus.focus();
    returnFocus = undefined;
  }
  on(view.form, 'input', (event) =>
    safe(() => {
      const target = event.target;
      const key =
        target === fields.name
          ? 'name'
          : target === fields.longitude
            ? 'longitude'
            : target === fields.latitude
              ? 'latitude'
              : undefined;
      if (!key) return;
      if (session.selectedId) {
        buffers.set(session.selectedId, values());
        if (complete(values())) invalidPoints.delete(session.selectedId);
        else invalidPoints.add(session.selectedId);
        const value =
          key === 'name'
            ? fields.name.value
            : numberInput(fields[key].value, key === 'longitude' ? 180 : 90);
        if (value !== undefined)
          session.draft = updateAuthorPoint(session.draft, session.selectedId, { [key]: value });
        updateRow(session.selectedId);
      } else newDirty = true;
      disablePending();
      schedule();
    }),
  );
  on(view.form, 'submit', (event) => {
    event.preventDefault();
    safe(() => {
      if (session.selectedId) return;
      newDirty = true;
      const value = values();
      if (!complete(value)) {
        disablePending();
        schedule();
        return;
      }
      session.draft = addAuthorPoint(session.draft, {
        name: value.name,
        longitude: numberInput(value.longitude, 180)!,
        latitude: numberInput(value.latitude, 90)!,
      });
      syncPoints();
      select(session.draft.points.at(-1)!.id);
    });
  });
  on(find('[data-new]'), 'click', () => select());
  on(find('[data-fit]'), 'click', () =>
    map?.render(session.draft, session.selectedId, { fitView: true }),
  );
  on(zoom, 'input', () =>
    safe(() => {
      const value = zoom.value.trim() === '' ? undefined : numberInput(zoom.value, 20);
      zoomInvalid = zoom.value.trim() !== '' && (value === undefined || value < 2);
      if (!zoomInvalid) session.draft = setAuthorZoom(session.draft, value);
      zoomWarning();
      disablePending();
      schedule();
    }),
  );
  on(view.pointList, 'click', (event) =>
    safe(() => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>('[data-point-id]');
      if (!row) return;
      const id = row.dataset.pointId!;
      if (target.closest('[data-select]')) select(id);
      else if (target.closest('[data-up], [data-down]')) {
        session.draft = moveAuthorPoint(
          session.draft,
          id,
          target.closest('[data-up]') ? 'up' : 'down',
        );
        syncPoints();
        schedule();
      } else if (target.closest('[data-route-add]')) {
        session.draft = setAuthorRoute(session.draft, [...session.draft.route, id]);
        syncRoute();
        schedule();
      } else if (target.closest('[data-delete]')) {
        deleteId = id;
        const count = session.draft.route.filter((stop) => stop === id).length;
        find('[data-delete-summary]').textContent =
          `删除 ${session.draft.points.find((point) => point.id === id)!.name}？线路引用 ${count} 次。${session.draft.representativeId === id ? '此地点为代表地点，删除后必须明确选择新的代表地点。' : ''}`;
        open(view.deleteDialog);
      }
    }),
  );
  on(view.pointList, 'change', (event) =>
    safe(() => {
      const target = event.target;
      if (!(target instanceof owner.HTMLInputElement) || target.type !== 'radio' || !target.checked)
        return;
      session.draft = selectAuthorRepresentative(session.draft, target.value);
      syncPoints();
      schedule();
    }),
  );
  on(view.routeList, 'click', (event) =>
    safe(() => {
      const target = event.target as HTMLElement;
      const row = target.closest<HTMLElement>('[data-route-index]');
      if (!row) return;
      const index = Number(row.dataset.routeIndex);
      const route = [...session.draft.route];
      if (target.closest('[data-remove]')) route.splice(index, 1);
      else {
        const destination =
          index + (target.closest('[data-up]') ? -1 : target.closest('[data-down]') ? 1 : 0);
        if (destination === index || destination < 0 || destination >= route.length) return;
        [route[index], route[destination]] = [route[destination]!, route[index]!];
      }
      session.draft = setAuthorRoute(session.draft, route);
      syncRoute();
      schedule();
    }),
  );
  on(find('[data-delete-cancel]'), 'click', () => {
    deleteId = undefined;
    close(view.deleteDialog);
  });
  on(find('[data-delete-confirm]'), 'click', () =>
    safe(() => {
      if (!deleteId) return;
      const id = deleteId;
      deleteId = undefined;
      session.draft = deleteAuthorPoint(session.draft, id);
      buffers.delete(id);
      invalidPoints.delete(id);
      close(view.deleteDialog);
      syncRoute();
      syncPoints();
      if (session.selectedId === id) select(session.draft.points[0]?.id);
      else schedule();
      if (!returnFocus?.isConnected)
        pointRows
          .get(session.selectedId ?? '')
          ?.querySelector<HTMLButtonElement>('[data-select]')
          ?.focus();
    }),
  );
  on(find('[data-import-open]'), 'click', () => {
    imported = undefined;
    find<HTMLTextAreaElement>('[data-import-source]').value = '';
    find('[data-import-error]').textContent = '';
    find('[data-import-summary]').textContent = '';
    find<HTMLButtonElement>('[data-import-confirm]').hidden = true;
    open(view.importDialog);
  });
  on(find('[data-import-source]'), 'input', () => {
    imported = undefined;
    find<HTMLButtonElement>('[data-import-confirm]').hidden = true;
  });
  on(find('[data-import-validate]'), 'click', () => {
    const result = importAuthorYaml(find<HTMLTextAreaElement>('[data-import-source]').value);
    imported = result.ok ? result.map : undefined;
    find('[data-import-error]').textContent = result.ok
      ? ''
      : `导入失败：${result.issues.map((issue) => issue.fieldPath).join('、')}`;
    find('[data-import-summary]').textContent = result.ok
      ? `校验通过：${result.map.points.length} 个地点。${session.draft.points.length ? '确认后将替换当前非空草稿。' : '确认后导入草稿。'}`
      : '';
    find<HTMLButtonElement>('[data-import-confirm]').hidden = !result.ok;
  });
  on(find('[data-import-cancel]'), 'click', () => {
    imported = undefined;
    close(view.importDialog);
  });
  on(find('[data-import-confirm]'), 'click', () =>
    safe(() => {
      if (!imported) return;
      const next = createAuthorDraft(imported);
      generation += 1;
      queued = false;
      mapAbort.abort();
      map?.destroy();
      map = undefined;
      mapAbort = new AbortController();
      exports.destroy();
      session.draft = next;
      session.selectedId = next.points[0]?.id;
      buffers.clear();
      invalidPoints.clear();
      candidate = undefined;
      newDirty = zoomInvalid = false;
      imported = undefined;
      close(view.importDialog);
      syncRoute();
      syncPoints();
      showFields();
      metadata();
      exports = createAuthorExportControls(
        view.export,
        () => exportAuthorYaml(session.draft),
        pending,
      );
      startMap();
      schedule();
    }),
  );
  on(view.importDialog, 'cancel', () => {
    imported = undefined;
  });
  on(view.deleteDialog, 'cancel', () => {
    deleteId = undefined;
  });
  view.form.dataset.mounted = 'true';
  syncRoute();
  syncPoints();
  showFields();
  metadata();
  startMap();
  schedule();
  return {
    destroy() {
      if (!alive) return;
      alive = false;
      generation += 1;
      queued = false;
      mapAbort.abort();
      map?.destroy();
      exports.destroy();
      removers.forEach((remove) => remove());
      if (view.importDialog.open) view.importDialog.close();
      if (view.deleteDialog.open) view.deleteDialog.close();
      delete view.form.dataset.mounted;
      pointRows.forEach((row) => row.remove());
      routeRows.forEach((row) => row.remove());
    },
  };
}
