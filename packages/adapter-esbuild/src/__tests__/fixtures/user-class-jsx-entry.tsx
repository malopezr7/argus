// @ts-nocheck — bare aliases and JSX are intentionally resolved by EsbuildBundler.
/**
 * A class in the user's own TSX. The JSX has to survive the TypeScript strip
 * that class lowering requires, so this fixture is what stops the lowering path
 * from quietly dropping the JSX transform.
 */
import { Text } from 'react-native';

export class Label {
  constructor(public text: string) {}

  render() {
    return <Text>{this.text}</Text>;
  }
}

console.log(new Label('hola').render());
