export function configureSnapshots(entries: unknown, update: boolean): void {
  (globalThis as Record<string, unknown>).__argusSnapshotOrder =
    `${JSON.stringify(entries)}:${String(update)}:config`;
}
