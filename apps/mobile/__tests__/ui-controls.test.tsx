import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { Button } from '@/components/button';
import { IconButton } from '@/components/icon';
import { Screen } from '@/components/screen';
import { Colors } from '@/theme';

function luminance(hex: string) {
  const rgb = [1, 3, 5].map((i) => {
    const value = parseInt(hex.slice(i, i + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0]! + 0.05) / (values[1]! + 0.05);
}

describe('shared UI controls', () => {
  it('keeps icon actions labelled and at least 44 points in both dimensions', async () => {
    const onPress = jest.fn();
    await render(<IconButton icon="edit" label="Edit Push day" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Edit Push day' });
    expect(StyleSheet.flatten(button.props.style)).toMatchObject({ width: 44, minHeight: 44 });
    await fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('disables loading icon actions without losing their accessible label', async () => {
    const onPress = jest.fn();
    await render(
      <IconButton icon="duplicate" label="Duplicate workout" loading onPress={onPress} />,
    );
    const button = screen.getByRole('button', { name: 'Duplicate workout' });
    expect(button).toBeDisabled();
    await fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('uses contrasting text on the primary action', async () => {
    await render(<Button title="Log drink" onPress={jest.fn()} />);
    expect(StyleSheet.flatten(screen.getByText('Log drink').props.style).color).toBe(
      Colors.onAccent,
    );
    expect(contrast(Colors.onAccent, Colors.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps helper and status text above 4.5:1 on every app surface', () => {
    for (const foreground of [
      Colors.text,
      Colors.textSecondary,
      Colors.textMuted,
      Colors.accent,
      Colors.error,
      Colors.earned,
      Colors.drunk,
    ]) {
      for (const background of [Colors.background, Colors.surface, Colors.surfaceRaised]) {
        expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the primary footer outside the scrolling form, without an absolute overlay', async () => {
    await render(
      <Screen footer={<Button title="Save" onPress={jest.fn()} />}>
        <Text>Form content</Text>
      </Screen>,
    );
    const footer = screen.getByTestId('screen-footer');
    expect(within(footer).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(StyleSheet.flatten(footer.props.style).position).not.toBe('absolute');
    expect(
      within(screen.getByTestId('screen-content')).queryByRole('button', { name: 'Save' }),
    ).toBeNull();
  });
});
