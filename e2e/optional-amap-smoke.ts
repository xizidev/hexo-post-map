interface SmokeSteps {
  navigate(timeout: number): Promise<unknown>;
  initialize(timeout: number): Promise<unknown>;
  annotate(annotation: { type: string; description: string }): void;
  warn(message: string): void;
}

export async function runOptionalAmapSmoke(steps: SmokeSteps): Promise<void> {
  try {
    await steps.navigate(5_000);
    await steps.initialize(7_000);
  } catch {
    steps.annotate({
      type: 'amap-smoke-warning',
      description: 'Live AMap did not initialize; check provider/domain configuration privately.',
    });
    steps.warn('Optional AMap smoke did not initialize (non-blocking).');
  }
}
