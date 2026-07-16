// @ts-nocheck — bare aliases and JSX are intentionally resolved by EsbuildBundler.
import { Text } from 'react-native';

const marker = __DEV__ ? 'argus-dev-enabled' : 'argus-dev-disabled';

export const fixture = <Text>{marker}</Text>;
console.log(marker, fixture);
