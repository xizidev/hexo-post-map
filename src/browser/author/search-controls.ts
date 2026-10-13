import type { AuthorPlace, AuthorPlaceSearch } from './search';

const readyMessage = '输入地点名称，按回车或点击搜索；城市留空时搜索全国。';
const manualMessage = '手动模式：地点搜索暂不可用，可继续填写坐标并导出。';
const errors = {
  quota: '搜索额度或频率受限，请查看高德控制台或稍后重试；可继续手动选点。',
  configuration: '搜索权限或地图配置不可用，请检查高德控制台；可继续手动选点。',
  timeout: '搜索超时，请稍后重试；可继续手动选点。',
  unavailable: '地点搜索暂不可用，请稍后重试；可继续手动选点。',
};

export function createAuthorSearchControls(
  root: HTMLElement,
  search: AuthorPlaceSearch | undefined,
  onChoose: (place: AuthorPlace) => boolean,
): { reset(): void; destroy(): void } {
  const document = root.ownerDocument;
  const owner = document.defaultView!;
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
  const form = find<HTMLFormElement>('[data-search-form]');
  const keyword = find<HTMLInputElement>('[data-search-keyword]');
  const city = find<HTMLInputElement>('[data-search-city]');
  const submit = find<HTMLButtonElement>('[data-search-submit]');
  const status = find('[data-search-status]');
  const results = find('[data-search-results]');
  let alive = true;
  let generation = 0;
  let abort: AbortController | undefined;
  let current: readonly AuthorPlace[] = [];
  let busy = false;
  function invalidate() {
    generation += 1;
    abort?.abort();
    abort = undefined;
    busy = false;
    current = [];
    results.replaceChildren();
    results.hidden = true;
    results.setAttribute('aria-busy', 'false');
    submit.disabled = !search;
  }
  function edited() {
    invalidate();
    status.textContent = search ? readyMessage : manualMessage;
  }
  async function run() {
    if (!alive || !search || busy) return;
    invalidate();
    const query = { keyword: keyword.value.trim(), city: city.value.trim() };
    if (!query.keyword) {
      status.textContent = '请输入地点名称。';
      return;
    }
    if (query.keyword.length > 100 || query.city.length > 60) {
      status.textContent = '地点名称最多 100 字，城市最多 60 字。';
      return;
    }
    const ticket = generation;
    abort = new AbortController();
    busy = true;
    submit.disabled = true;
    results.setAttribute('aria-busy', 'true');
    status.textContent = '正在搜索地点…';
    try {
      const outcome = await search(query, abort.signal);
      if (!alive || ticket !== generation) return;
      busy = false;
      submit.disabled = false;
      results.setAttribute('aria-busy', 'false');
      if (outcome.state === 'cancelled') {
        status.textContent = readyMessage;
        return;
      }
      if (outcome.state === 'error') {
        status.textContent = errors[outcome.reason];
        return;
      }
      current = outcome.places;
      current.forEach((place, index) => {
        const row = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.searchResult = String(index);
        const name = document.createElement('strong');
        name.textContent = place.name;
        const address = document.createElement('span');
        address.textContent = [place.city, place.address].filter(Boolean).join(' · ') || '地址暂无';
        button.append(name, address);
        row.append(button);
        results.append(row);
      });
      results.hidden = current.length === 0;
      status.textContent = current.length
        ? `找到 ${current.length} 个地点，请选择正确的地点。`
        : '未找到可选地点，请补充具体名称或城市后重试；可继续手动选点。';
    } catch {
      if (!alive || ticket !== generation) return;
      invalidate();
      status.textContent = errors.unavailable;
    }
  }
  function submitted(event: Event) {
    event.preventDefault();
    void run();
  }
  function chosen(event: Event) {
    if (!alive || !(event.target instanceof owner.Element)) return;
    const button = event.target.closest<HTMLButtonElement>('[data-search-result]');
    if (!button || !results.contains(button)) return;
    const index = Number(button.dataset.searchResult);
    const place = Number.isInteger(index) ? current[index] : undefined;
    if (!place) return;
    if (!onChoose(place)) return;
    invalidate();
    status.textContent = '已定位候选地点，请确认添加；添加后可拖动调整。';
  }
  form.addEventListener('submit', submitted);
  keyword.addEventListener('input', edited);
  city.addEventListener('input', edited);
  results.addEventListener('click', chosen);
  edited();
  return {
    reset() {
      if (alive) {
        keyword.value = city.value = '';
        edited();
      }
    },
    destroy() {
      if (!alive) return;
      alive = false;
      invalidate();
      form.removeEventListener('submit', submitted);
      keyword.removeEventListener('input', edited);
      city.removeEventListener('input', edited);
      results.removeEventListener('click', chosen);
    },
  };
}
