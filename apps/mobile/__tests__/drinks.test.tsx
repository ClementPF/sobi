import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';

import { getDashboard, listContainers, logDrink } from '@/api/endpoints';
import type { Container } from '@/api/types';
import { useUnits } from '@/auth/session';
import { DrinksScreen, volumeOf } from '@/features/drinks/drinks-screen';
import { CONTAINER_PORTIONS, portionVolume } from '@/features/drinks/portions';
import { queryKeys } from '@/lib/queries';

jest.mock('@/auth/session', () => ({ useUnits: jest.fn(() => 'metric') }));
jest.mock('@/api/endpoints', () => ({
  createContainer: jest.fn(),
  deleteContainer: jest.fn(),
  getDashboard: jest.fn(),
  listContainers: jest.fn(),
  logDrink: jest.fn(),
  updateContainer: jest.fn(),
}));

const can: Container = { id: 'can', name: 'Can', volumeMl: 330 };
const bottle: Container = { id: 'bottle', name: 'Bottle', volumeMl: 750 };
let client: QueryClient;

beforeEach(() => {
  jest.resetAllMocks();
  client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false, gcTime: Infinity },
    },
  });
  jest.mocked(useUnits).mockReturnValue('metric');
  jest.mocked(listContainers).mockResolvedValue([can, bottle]);
  jest.mocked(getDashboard).mockResolvedValue({
    range: '7d',
    from: '2026-11-11',
    to: '2026-11-18',
    balance: 5,
    totalEarned: 5,
    totalDrunk: 0,
    rangeEarned: 5,
    rangeDrunk: 0,
    series: [],
    weekly: [],
    stats: {
      avgDrunkPerWeek: 0,
      avgEarnedPerWeek: 5,
      sessionsPerWeek: 1,
      dryStreakDays: 7,
      maxDryStreakDays: 7,
      topDrinkingWeekday: null,
    },
  });
  jest.mocked(logDrink).mockImplementation(async (body) => ({
    id: 'drink',
    abv: body.abv,
    volumeMl: body.volumeMl!,
    containerId: body.containerId ?? null,
    containerName: body.containerId === can.id ? can.name : null,
    consumedAt: '2026-11-18T20:00:00Z',
    alcoholG: ((body.volumeMl! * body.abv) / 100) * 0.789,
    stdDrinks: (((body.volumeMl! * body.abv) / 100) * 0.789) / 14,
    note: body.note ?? null,
  }));
});

afterEach(() => client.clear());

async function renderDrinks() {
  await render(
    <QueryClientProvider client={client}>
      <DrinksScreen />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Log drink' });
}

describe('container portion scale', () => {
  it('runs from fractions through one to whole and mixed quantities without duplicates', () => {
    const values = CONTAINER_PORTIONS.map((item) => item.value);
    expect(values[0]).toBe(1 / 8);
    expect(values.at(-1)).toBe(20);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((value, i) => i === 0 || value > values[i - 1]!)).toBe(true);
    expect(CONTAINER_PORTIONS).toEqual(
      expect.arrayContaining([
        { value: 1 / 3, label: '⅓' },
        { value: 1 / 2, label: '½' },
        { value: 1, label: '1' },
        { value: 1.5, label: '1½' },
        { value: 2.75, label: '2¾' },
      ]),
    );
  });

  it('rounds stored ml once and enforces the API bounds', () => {
    expect(portionVolume(355, 1 / 3)).toBe(118);
    expect(portionVolume(355, 1 / 2)).toBe(178);
    expect(portionVolume(330, 2.5)).toBe(825);
    expect(portionVolume(500, 20)).toBe(10_000);
    expect(portionVolume(501, 20)).toBeNull();
    expect(portionVolume(1, 1 / 8)).toBeNull();
    for (const value of [0, -1, NaN, Infinity]) {
      expect(portionVolume(330, value)).toBeNull();
    }
  });

  it('scales containers in stored units without applying the multiplier to custom volumes', () => {
    expect(volumeOf({ kind: 'container', container: can }, 'metric', 0.5)).toBe(165);
    expect(volumeOf({ kind: 'container', container: can }, 'imperial', 0.5)).toBe(165);
    expect(volumeOf({ kind: 'custom', text: '200' }, 'metric', 2)).toBe(200);
    expect(volumeOf(null, 'metric', 2)).toBeNull();
  });
});

describe('drink amount wheel', () => {
  it('separates the ABV group from Quantity while keeping its two digits together in one row', async () => {
    await renderDrinks();
    expect(screen.getByTestId('drink-fields')).toHaveStyle({ flexDirection: 'row', gap: 8 });
    const strength = screen.getByTestId('drink-strength');
    expect(strength).toHaveStyle({ width: 92, marginStart: 8 });
    expect(within(strength).getByLabelText('ABV whole percent')).toBeTruthy();
    expect(within(strength).getByLabelText('ABV tenths')).toBeTruthy();
    expect(within(strength).queryByLabelText('Quantity')).toBeNull();
    expect(screen.getByLabelText('Quantity')).toBeTruthy();
  });

  it('keeps time compact by default and preserves all inputs when time is expanded then collapsed', async () => {
    await renderDrinks();
    expect(screen.queryByRole('radio', { name: 'Yesterday' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Change drink time' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Yesterday' }));
    expect(screen.getByLabelText('hour').props.accessibilityValue.text).toBe('20');
    await fireEvent.press(screen.getByRole('button', { name: 'Change drink time' }));
    expect(screen.getByText('Yesterday · 20:00')).toBeTruthy();
    expect(screen.queryByLabelText('hour')).toBeNull();
    await fireEvent.press(screen.getByLabelText('ABV whole percent 12'));
    await fireEvent.press(screen.getByLabelText('ABV tenths .5'));
    await fireEvent.changeText(screen.getByLabelText('Note'), '  Dinner  ');
    expect(screen.getByTestId('drink-preview')).toHaveTextContent(/330 ml × 12.5%/);
    await fireEvent.press(screen.getByRole('button', { name: 'Log drink' }));
    await waitFor(() =>
      expect(logDrink).toHaveBeenCalledWith(
        expect.objectContaining({
          abv: 12.5,
          volumeMl: 330,
          containerId: 'can',
          note: 'Dinner',
          consumedAt: expect.any(String),
        }),
      ),
    );
    const timestamp = new Date(jest.mocked(logDrink).mock.calls[0]![0].consumedAt!);
    expect(timestamp.getHours()).toBe(20);
    expect(timestamp.getMinutes()).toBe(0);
    await screen.findByText('Logged 2.32 standard drinks.');
    expect(screen.getByText('Now')).toBeTruthy();
    expect(screen.getByLabelText('Note').props.value).toBe('');
  });

  it('orders containers by stored volume, defaults to the smallest, and keeps Custom last', async () => {
    jest
      .mocked(listContainers)
      .mockResolvedValue([bottle, can, { id: 'small', name: 'Shot', volumeMl: 44 }]);
    await renderDrinks();
    expect(screen.getByLabelText('Container').props.accessibilityValue.text).toBe('Shot 44 ml');
    expect(
      screen.getAllByLabelText(/^Container /).map((item) => item.props.accessibilityLabel),
    ).toEqual([
      'Container Shot 44 ml',
      'Container Can 330 ml',
      'Container Bottle 750 ml',
      'Container Custom volume',
    ]);
    await fireEvent.press(screen.getByLabelText('Container Can 330 ml'));
    expect(screen.getByTestId('drink-preview')).toHaveTextContent(/330 ml × 5%/);
  });

  it('sorts by exact ml even when imperial display volumes round to the same value', async () => {
    jest.mocked(useUnits).mockReturnValue('imperial');
    jest.mocked(listContainers).mockResolvedValue([
      { id: 'larger', name: 'Larger', volumeMl: 36 },
      { id: 'smaller', name: 'Smaller', volumeMl: 35 },
    ]);
    await renderDrinks();
    expect(screen.getByLabelText('Container').props.accessibilityValue.text).toBe(
      'Smaller 1.2 fl oz',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Log drink' }));
    await waitFor(() =>
      expect(logDrink).toHaveBeenCalledWith(
        expect.objectContaining({ containerId: 'smaller', volumeMl: 35 }),
      ),
    );
    await screen.findByText('Logged 0.1 standard drinks.');
  });

  it('allows custom entry when no saved containers exist', async () => {
    jest.mocked(listContainers).mockResolvedValue([]);
    await renderDrinks();
    expect(screen.queryByLabelText('Quantity')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Custom volume in ml'), '200');
    expect(screen.getByTestId('drink-preview')).toHaveTextContent(/200 ml × 5%/);
  });

  it('defaults to one container and keeps normal drink logging one tap', async () => {
    await renderDrinks();
    expect(screen.getByLabelText('Quantity').props.accessibilityValue.text).toBe('1');
    expect(screen.getByTestId('drink-preview')).toHaveTextContent(/330 ml × 5%/);
    await fireEvent.press(screen.getByRole('button', { name: 'Log drink' }));
    await waitFor(() =>
      expect(logDrink).toHaveBeenCalledWith(
        expect.objectContaining({
          containerId: 'can',
          volumeMl: 330,
          abv: 5,
        }),
      ),
    );
    await screen.findByText('Logged 0.93 standard drinks.');
  });

  it.each([
    ['½', 165],
    ['⅓', 110],
    ['2', 660],
    ['2½', 825],
  ])(
    'previews and logs %s containers as %s ml without changing the container',
    async (label, ml) => {
      await renderDrinks();
      await fireEvent.press(screen.getByLabelText(`Quantity ${label}`));
      expect(screen.getByTestId('drink-preview')).toHaveTextContent(new RegExp(`${ml} ml × 5%`));
      client.setQueryData(queryKeys.history, { days: [] });
      await fireEvent.press(screen.getByRole('button', { name: 'Log drink' }));
      await waitFor(() =>
        expect(logDrink).toHaveBeenCalledWith(
          expect.objectContaining({
            containerId: 'can',
            volumeMl: ml,
          }),
        ),
      );
      await waitFor(() =>
        expect(screen.getByLabelText('Quantity').props.accessibilityValue.text).toBe('1'),
      );
      expect(client.getQueryState(queryKeys.history)?.isInvalidated).toBe(true);
      expect(can.volumeMl).toBe(330);
    },
  );

  it('uses the actual ml for imperial portions instead of round-tripping displayed ounces', async () => {
    jest.mocked(useUnits).mockReturnValue('imperial');
    jest.mocked(listContainers).mockResolvedValue([{ ...can, volumeMl: 355 }]);
    await renderDrinks();
    await fireEvent.press(screen.getByLabelText('Quantity ⅓'));
    expect(screen.getByTestId('drink-preview')).toHaveTextContent(/4 fl oz × 5%/);
    await fireEvent.press(screen.getByRole('button', { name: 'Log drink' }));
    await waitFor(() =>
      expect(logDrink).toHaveBeenCalledWith(expect.objectContaining({ volumeMl: 118 })),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Log drink' })).toBeEnabled());
  });

  it('resets the quantity when switching containers or choosing Reset', async () => {
    await renderDrinks();
    await fireEvent.press(screen.getByLabelText('Quantity 2'));
    await fireEvent.press(screen.getByLabelText('Container Bottle 750 ml'));
    expect(screen.getByTestId('drink-preview')).toHaveTextContent(/750 ml × 5%/);
    await fireEvent.press(screen.getByLabelText('Quantity ½'));
    expect(screen.getByTestId('drink-preview')).toHaveTextContent(/375 ml × 5%/);
    await fireEvent.press(screen.getByRole('button', { name: 'Reset to one container' }));
    expect(screen.getByTestId('drink-preview')).toHaveTextContent(/750 ml × 5%/);
  });

  it('keeps custom volume entry independent and hides the container wheel', async () => {
    await renderDrinks();
    await fireEvent.press(screen.getByLabelText('Quantity 2'));
    await fireEvent.press(screen.getByLabelText('Container Custom volume'));
    expect(screen.queryByLabelText('Quantity')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Custom volume in ml'), '200');
    expect(screen.getByTestId('drink-preview')).toHaveTextContent(/200 ml × 5%/);
    await fireEvent.press(screen.getByRole('button', { name: 'Log drink' }));
    await waitFor(() =>
      expect(logDrink).toHaveBeenCalledWith(expect.objectContaining({ volumeMl: 200 })),
    );
    expect(jest.mocked(logDrink).mock.calls[0]![0].containerId).toBeUndefined();
    await screen.findByText('Logged 0.56 standard drinks.');
  });

  it('prevents out-of-range totals instead of silently clamping them', async () => {
    await renderDrinks();
    await fireEvent.press(screen.getByLabelText('Container Bottle 750 ml'));
    await fireEvent.press(screen.getByLabelText('Quantity 20'));
    expect(screen.getByText('Total must be between 1 and 10,000 ml.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log drink' })).toBeDisabled();
    await fireEvent.press(screen.getByRole('button', { name: 'Log drink' }));
    expect(logDrink).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Reset to one container' }));
    expect(screen.getByRole('button', { name: 'Log drink' })).toBeEnabled();
  });

  it('keeps the selected portion on failure so a retry logs the same amount', async () => {
    jest.mocked(logDrink).mockRejectedValueOnce(new Error('Could not log drink.'));
    await renderDrinks();
    await fireEvent.press(screen.getByLabelText('Quantity ½'));
    await fireEvent.press(screen.getByRole('button', { name: 'Log drink' }));
    await screen.findByText('Could not log drink.');
    expect(screen.getByTestId('drink-preview')).toHaveTextContent(/165 ml × 5%/);
    await fireEvent.press(screen.getByRole('button', { name: 'Log drink' }));
    await screen.findByText('Logged 0.46 standard drinks.');
    expect(jest.mocked(logDrink).mock.calls.map(([body]) => body.volumeMl)).toEqual([165, 165]);
  });
});
