/** Runs async tasks strictly one-at-a-time in submission order. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();
  /** Tasks queued or running. */
  pending = 0;

  push<T>(task: () => Promise<T>): Promise<T> {
    this.pending++;
    // Chain onto tail so each task waits for the previous to settle.
    // Swallow prior errors here so one failure can't break the chain.
    const run = this.tail.then(() => task(), () => task()).finally(() => this.pending--);
    this.tail = run.catch(() => {});
    return run;
  }

  /** Resolves once every task pushed so far has settled. */
  drain(): Promise<unknown> {
    return this.tail;
  }
}
