import type { DrumItem } from '@/components/drum-picker';

const FRACTIONS = ['', '¼', '½', '¾'];

/** A single scale: common portions below one, then quarter-container increments up to 20. */
export const CONTAINER_PORTIONS: DrumItem<number>[] = [
  { value: 1 / 8, label: '⅛' },
  { value: 1 / 6, label: '⅙' },
  { value: 1 / 5, label: '⅕' },
  { value: 1 / 4, label: '¼' },
  { value: 1 / 3, label: '⅓' },
  { value: 1 / 2, label: '½' },
  { value: 2 / 3, label: '⅔' },
  { value: 3 / 4, label: '¾' },
  ...Array.from({ length: 77 }, (_, i) => ({
    value: 1 + i / 4,
    label: `${Math.floor(1 + i / 4)}${FRACTIONS[i % 4]}`,
  })),
];

/** Scale stored ml, rounding only once to match the API's whole-ml volume. */
export function portionVolume(volumeMl: number, portion: number): number | null {
  if (!Number.isFinite(portion) || portion <= 0) return null;
  const total = Math.round(volumeMl * portion);
  return Number.isInteger(total) && total >= 1 && total <= 10_000 ? total : null;
}
