/**
 * A class in a .tsx inside a project whose tsconfig asks for a DIFFERENT JSX
 * transform than the build uses.
 *
 * The build's JSX settings are not the project's to override: a file that takes
 * the lowering detour has to come out of it transformed exactly like one that
 * did not, or the two halves of the same bundle disagree about what JSX means.
 */
import { Text } from 'react-native';

export class Panel {
  render() {
    return <Text>panel</Text>;
  }
}

console.log(new Panel().render());
