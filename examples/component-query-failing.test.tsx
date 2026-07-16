import { render, screen } from 'argus';
import { Text, View } from 'react-native';

describe('component query failure reporting', () => {
  test('reports multiple singular matches', () => {
    render(
      <View>
        <Text>duplicate</Text>
        <Text>duplicate</Text>
      </View>,
    );

    screen.getByText('duplicate');
  });
});
