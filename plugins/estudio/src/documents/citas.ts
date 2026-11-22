import { pageText, type EstructuraV1 } from './estructura.ts';

/* Port of KBOL's kbol/citas.py (`normalizar`, `_contiene`, and `resolver_pdf` for physical anchors).
 * Character classes mirror Python's `re` on str: `\w` is letters, numbers and underscore (no combining marks),
 * and `\s` is exactly what str.isspace() accepts (JS differs on U+FEFF and U+001C to U+001F). */
const WORD = '[\\p{L}\\p{N}_]';
const SPACE = '[\\t\\n\\x0B\\x0C\\r\\x1C-\\x1F \\x85\\xA0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]';
const SPACES = new RegExp(`${SPACE}+`, 'gu');
const EDGES = new RegExp(`^${SPACE}+|${SPACE}+$`, 'gu');
export const LINE_BREAK_HYPHEN = new RegExp(`(${WORD})-${SPACE}*\\n${SPACE}*(${WORD})`, 'gu');
const QUOTES: Record<string, string> = { '«': '"', '»': '"', '“': '"', '”': '"', '„': '"', '‘': "'", '’': "'", '‚': "'" };

export function normalizeQuote(text: string): string {
  const t = text.normalize('NFKC').replaceAll('­', '').replace(LINE_BREAK_HYPHEN, '$1$2');
  return t.replace(/[«»“”„‘’‚]/g, c => QUOTES[c]!).replace(SPACES, ' ').replace(EDGES, '').toLowerCase();
}

export type Match = 'exacta' | 'sin espacios';

export function contains(text: string, literal: string): Match | null {
  const t = normalizeQuote(text), lit = normalizeQuote(literal);
  if (t.includes(lit)) return 'exacta';
  if (t.replaceAll(' ', '').includes(lit.replaceAll(' ', ''))) return 'sin espacios';
  return null;
}

const PDF_ANCHOR = /^pdf-v1:p=(\d+)(?:;r=([^;]+))?$/;
const COORD = /^(?:0|1)(?:\.\d{1,4})?$/;

export function parsePdfAnchor(anchor: string): { p: number; r?: [number, number, number, number] } | null {
  const m = PDF_ANCHOR.exec(anchor.trim());
  if (!m || Number(m[1]) < 1) return null;
  if (m[2] === undefined) return { p: Number(m[1]) };
  const parts = m[2].split(',');
  if (parts.length !== 4 || !parts.every(v => COORD.test(v))) return null;
  const [x0, y0, x1, y1] = parts.map(Number) as [number, number, number, number];
  if (x1 > 1 || y1 > 1 || !(x0 < x1) || !(y0 < y1)) return null;
  return { p: Number(m[1]), r: [x0, y0, x1, y1] };
}

export function formatPdfAnchor(page: number): string {
  return `pdf-v1:p=${page}`;
}

export interface QuoteCheck { estado: 'resuelta' | 'rota' | 'no_comprobable'; coincidencia?: Match; motivo: string }

/** Whether a literal quote is on the given page of the representation. The original's own hash is checked by the caller. */
export function verifyQuote(estructura: EstructuraV1, page: number, quote: string): QuoteCheck {
  if (normalizeQuote(quote) === '') return { estado: 'no_comprobable', motivo: 'no hay cita literal que comprobar' };
  const text = pageText(estructura, page);
  if (text === null) return { estado: 'rota', motivo: `la página ${page} no existe en la representación` };
  const match = contains(text, quote);
  if (match === null) return { estado: 'rota', motivo: `la cita literal no aparece en la página ${page}` };
  return {
    estado: 'resuelta', coincidencia: match,
    motivo: match === 'exacta' ? 'resuelta' : 'la cita literal coincide sin espacios (palabras partidas en la representación)',
  };
}
