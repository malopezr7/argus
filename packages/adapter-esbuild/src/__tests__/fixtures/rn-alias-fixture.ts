// @ts-expect-error Argus aliases react-native to its in-realm shim at bundle time.
import { NativeModules, TurboModuleRegistry } from 'react-native';

void NativeModules;
void TurboModuleRegistry.get;
void TurboModuleRegistry.getEnforcing;
