/**
 * A method decorator written against `experimentalDecorators: true` — the
 * TypeScript legacy protocol, where the decorator receives
 * (target, key, descriptor) and mutates the descriptor.
 *
 * Under the ES-decorators proposal the same function is called with a
 * completely different shape and `descriptor` is undefined, so the file dies
 * before any test runs. Which protocol esbuild emits is decided by the
 * project's tsconfig — so this fixture only behaves if that tsconfig is read.
 */
function log(_target: unknown, _key: string, descriptor: PropertyDescriptor) {
  const original = descriptor.value;
  descriptor.value = function (this: unknown, ...args: unknown[]) {
    return `logged:${original.apply(this, args)}`;
  };
  return descriptor;
}

export class Svc {
  @log
  run(): string {
    return 'ran';
  }
}

console.log(new Svc().run());
