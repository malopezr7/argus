/**
 * @argus/framework — React Native native-module shim registry.
 */

const registry: Record<string, unknown> = Object.create(null) as Record<string, unknown>;

export function mockNativeModule(name: string, factory: () => unknown): void {
  registry[name] = factory();
}

export function resetNativeModules(): void {
  const keys = Object.keys(registry);
  for (let i = 0; i < keys.length; i++) {
    delete registry[keys[i]];
  }
}

export const TurboModuleRegistry = {
  get(name: string): unknown {
    return Object.hasOwn(registry, name) ? registry[name] : null;
  },
  getEnforcing(name: string): unknown {
    if (!Object.hasOwn(registry, name)) {
      throw new Error(`TurboModuleRegistry.getEnforcing('${name}'): module not registered`);
    }
    return registry[name];
  },
};

export const NativeModules: Record<string, unknown> = registry;
export const UIManager: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
