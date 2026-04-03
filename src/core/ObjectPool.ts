export class ObjectPool<T> {
  private readonly items: T[] = [];
  private readonly factory: () => T;

  public constructor(factory: () => T, initialSize: number) {
    this.factory = factory;
    for (let i = 0; i < initialSize; i += 1) {
      this.items.push(this.factory());
    }
  }

  public acquire(): T {
    return this.items.pop() ?? this.factory();
  }

  public release(item: T): void {
    this.items.push(item);
  }

  public size(): number {
    return this.items.length;
  }
}
