// Named test fixtures for the E2E bridge. Each fixture mutates Dexie to a
// known state. Add new fixtures as flows need them — bridge.seed(name)
// dispatches here.

export async function applyFixture(name: string): Promise<void> {
  switch (name) {
    case 'empty':
      // No-op; bridge.reset() already left Dexie empty.
      return;
    default:
      throw new Error(`test-fixtures: unknown fixture "${name}"`);
  }
}
