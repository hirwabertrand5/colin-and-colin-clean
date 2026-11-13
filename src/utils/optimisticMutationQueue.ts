export type OptimisticMutation<T> = {
  key: string;
  apply: (state: T) => T;
  save: () => Promise<T>;
  onFailure?: () => void;
};

/** Display queued edits immediately; persist in order so dependencies remain valid. */
export class OptimisticMutationQueue<T> {
  private confirmed: T | null = null;
  private pending: OptimisticMutation<T>[] = [];
  private running = false;
  private generation = 0;
  constructor(private callbacks: {
    change: (state: T, keys: string[]) => void;
    settled: (state: T) => void;
    failed: (message: string) => void;
  }) {}

  reset(state: T) { this.generation++; this.pending = []; this.running = false; this.confirmed = state; }
  dispose() { this.generation++; this.pending = []; this.running = false; }
  has(key: string) { return this.pending.some(item => item.key === key); }
  get size() { return this.pending.length; }

  enqueue(mutation: OptimisticMutation<T>) {
    if (this.confirmed === null || this.has(mutation.key)) return;
    this.pending.push(mutation);
    this.publish();
    if (!this.running) void this.flush();
  }

  private publish() {
    if (this.confirmed !== null) this.callbacks.change(this.pending.reduce((value, mutation) => mutation.apply(value), this.confirmed), this.pending.map(item => item.key));
  }

  private async flush() {
    this.running = true;
    const generation = this.generation;
    while (this.pending.length && generation === this.generation) {
      const mutation = this.pending[0]!;
      try {
        const result = await mutation.save();
        if (generation !== this.generation) return;
        this.confirmed = result;
        this.pending.shift();
        this.publish();
      } catch (error: any) {
        if (generation !== this.generation) return;
        const cancelled = this.pending.splice(0);
        this.publish();
        for (const item of cancelled) item.onFailure?.();
        this.callbacks.failed(`${error?.message || 'The change could not be saved.'}${cancelled.length > 1 ? ' Later queued changes were cancelled; please try them again.' : ''}`);
      }
    }
    if (generation !== this.generation) return;
    this.running = false;
    if (this.confirmed !== null) this.callbacks.settled(this.confirmed);
  }
}
