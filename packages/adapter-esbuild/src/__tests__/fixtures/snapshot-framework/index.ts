export function run(): void {
  (globalThis as Record<string, unknown>).__argusSnapshotOrder += ':run';
}
