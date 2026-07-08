/** Runs async tasks strictly one-at-a-time in submission order. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  push<T>(task: () => Promise<T>): Promise<T> {
    // Chain onto tail so each task waits for the previous to settle.
    // Swallow prior errors here so one failure can't break the chain.
    const run = this.tail.then(() => task(), () => task());
    this.tail = run.catch(() => {});
    return run;
  }
}
