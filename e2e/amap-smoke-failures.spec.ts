import { test, expect } from './fixtures';
import { runOptionalAmapSmoke } from './optional-amap-smoke';

for (const failure of ['navigation', 'initialization']) {
  test(`optional AMap ${failure} failure stays bounded, nonblocking and redacted`, async () => {
    const annotations: { type: string; description: string }[] = [];
    const warnings: string[] = [];
    const budgets: number[] = [];
    let initializations = 0;
    const outcome = runOptionalAmapSmoke({
      async navigate(timeout) {
        budgets.push(timeout);
        if (failure === 'navigation')
          throw new Error('goto failed https://vendor.invalid/?key=sentinel-secret');
      },
      async initialize(timeout) {
        initializations++;
        budgets.push(timeout);
        throw new Error('provider timeout security=sentinel-secret');
      },
      annotate: (annotation) => annotations.push(annotation),
      warn: (warning) => warnings.push(warning),
    });
    await expect(outcome).resolves.toBeUndefined();
    expect(initializations).toBe(failure === 'navigation' ? 0 : 1);
    expect(annotations).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(annotations[0]?.type).toBe('amap-smoke-warning');
    expect(warnings[0]).toContain('non-blocking');
    expect(JSON.stringify({ annotations, warnings })).not.toMatch(
      /sentinel-secret|vendor\.invalid|security=|key=/u,
    );
    expect(budgets.every((budget) => budget > 0 && budget <= 8_000)).toBe(true);
    expect(budgets.reduce((sum, budget) => sum + budget, 0)).toBeLessThan(20_000);
  });
}

test('successful optional AMap initialization emits no warning', async () => {
  const events: string[] = [];
  await runOptionalAmapSmoke({
    async navigate() {
      events.push('navigate');
    },
    async initialize() {
      events.push('initialize');
    },
    annotate: () => events.push('annotation'),
    warn: () => events.push('warning'),
  });
  expect(events).toEqual(['navigate', 'initialize']);
});
