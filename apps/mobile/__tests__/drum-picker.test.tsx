import { fireEvent, render, screen } from '@testing-library/react-native';

import { DrumPicker, rangeItems, snapIndex } from '@/components/drum-picker';
import { composeAmount, splitAmount } from '@/features/workout/set-sheet';

const scrollEvent = (y: number) => ({
  nativeEvent: {
    contentOffset: { x: 0, y },
    velocity: { x: 0, y: 0 },
    contentSize: { width: 80, height: 2000 },
    layoutMeasurement: { width: 80, height: 200 },
  },
});

describe('snapIndex', () => {
  it('rounds the offset to the nearest row', async () => {
    expect(snapIndex(0, 40, 10)).toBe(0);
    expect(snapIndex(19, 40, 10)).toBe(0);
    expect(snapIndex(21, 40, 10)).toBe(1);
    expect(snapIndex(118, 40, 10)).toBe(3);
  });

  it('clamps to the first and last row', async () => {
    expect(snapIndex(-50, 40, 10)).toBe(0);
    expect(snapIndex(10_000, 40, 10)).toBe(9);
    expect(snapIndex(100, 40, 0)).toBe(0);
  });
});

describe('DrumPicker', () => {
  const items = rangeItems(0, 20, 5);

  it('reports the snapped value when scrolling settles', async () => {
    const onChange = jest.fn();
    await render(<DrumPicker testID="drum" items={items} value={0} onChange={onChange} />);
    await fireEvent(screen.getByTestId('drum'), 'momentumScrollEnd', scrollEvent(83));
    expect(onChange).toHaveBeenCalledWith(10);
  });

  it('does not report the value it already shows', async () => {
    const onChange = jest.fn();
    await render(<DrumPicker testID="drum" items={items} value={10} onChange={onChange} />);
    await fireEvent(screen.getByTestId('drum'), 'momentumScrollEnd', scrollEvent(80));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('settles on drag end without momentum', async () => {
    const onChange = jest.fn();
    await render(<DrumPicker testID="drum" items={items} value={0} onChange={onChange} />);
    await fireEvent(screen.getByTestId('drum'), 'scrollEndDrag', scrollEvent(1000));
    expect(onChange).toHaveBeenCalledWith(20);
  });

  it('selects a row when tapped', async () => {
    const onChange = jest.fn();
    await render(<DrumPicker label="reps" items={items} value={0} onChange={onChange} />);
    await fireEvent.press(screen.getByLabelText('reps 15'));
    expect(onChange).toHaveBeenCalledWith(15);
  });
});

describe('set amounts', () => {
  it('splits and composes time and distance drums', async () => {
    expect(splitAmount('seconds', 95)).toEqual([1, 35]);
    expect(composeAmount('seconds', [1, 35])).toBe(95);
    expect(splitAmount('meters', 2350)).toEqual([2, 3]);
    expect(composeAmount('meters', [2, 3])).toBe(2300);
    expect(composeAmount('count', [42])).toBe(42);
  });
});
