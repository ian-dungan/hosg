// The open sheets (the job board and the picks chooser): each registers how to close itself, so the room's
// controller can close what it opened when it goes away (a death that travels, a zone change), and a second board
// never stacks on the first.

export class Sheets {
  private open = new Map<string, () => void>();
  /** Registers sheet `kind` as open with its closer; a sheet of the same kind already open is closed first. */
  add(kind: string, close: () => void): void {
    const was = this.open.get(kind);
    this.open.set(kind, close);
    if (was && was !== close) was();
  }
  /** The sheet closed itself (or was answered). */
  remove(kind: string, close: () => void): void {
    if (this.open.get(kind) === close) this.open.delete(kind);
  }
  has(kind: string): boolean { return this.open.has(kind); }
  /** Closes every open sheet (each resolves as if cancelled). */
  closeAll(): void {
    const all = [...this.open.values()];
    this.open.clear();
    for (const c of all) c();
  }
}
