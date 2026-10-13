export interface AuthorView {
  readonly map: HTMLElement;
  readonly form: HTMLFormElement;
  readonly pointList: HTMLElement;
  readonly routeList: HTMLElement;
  readonly importDialog: HTMLDialogElement;
  readonly deleteDialog: HTMLDialogElement;
  readonly export: HTMLElement;
  readonly status: HTMLElement;
}

/** Bind the static, credential-free page within the supplied root only. */
export function createAuthorView(root: HTMLElement): AuthorView {
  function find<T extends HTMLElement>(selector: string): T {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error('Author editor markup is incomplete.');
    return element;
  }
  return {
    map: find('[data-map]'),
    form: find('[data-point-form]'),
    pointList: find('[data-point-list]'),
    routeList: find('[data-route-list]'),
    importDialog: find('[data-import-dialog]'),
    deleteDialog: find('[data-delete-dialog]'),
    export: find('[data-export]'),
    status: find('[data-status]'),
  };
}
