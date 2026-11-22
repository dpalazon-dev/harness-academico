import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import { parseThemeFile } from '../../../src/core/themes.ts';

const FILE = new URL('../../../docs/sistema-comun/temas/papel.json', import.meta.url);

/** WCAG 2 relative luminance and contrast ratio of two #rrggbb colours. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

test('the Papel theme is a valid light theme for the app and its text reads at WCAG AA', () => {
  const parsed = parseThemeFile(JSON.parse(fs.readFileSync(FILE, 'utf8')));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.error);
  const { mode, colors } = parsed.theme;
  assert.equal(mode, 'light');
  for (const ground of [colors.background, colors.surface]) {
    for (const ink of [colors.text, colors.textMuted, colors.error, colors.success, colors.warning, colors.accent]) {
      assert.ok(contrast(ink, ground) >= 4.5, `${ink} on ${ground}: ${contrast(ink, ground).toFixed(2)}`);
    }
  }
});
