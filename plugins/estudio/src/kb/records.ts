import { randomUUID } from 'node:crypto';
import yaml from 'js-yaml';
import { FOLDER, PREFIX, type KbRecord } from './types.ts';

export function newKbId(type: KbRecord['type']): string {
  return `${PREFIX[type]}-${randomUUID()}`;
}

export function recordPath(record: Pick<KbRecord, 'type' | 'id'>): string {
  return `kb/${FOLDER[record.type]}/${record.id}.md`;
}

const ORDER = ['id', 'type', 'clase', 'title', 'description', 'ambito', 'autor', 'eventos', 'sources', 'estado'];

/** Header keys in a fixed order (common fields first) so diffs stay small; strings that YAML would read as dates or numbers are quoted. */
export function renderRecord(record: KbRecord, body: string): string {
  const entries = Object.entries(record).filter(([, v]) => v !== undefined);
  entries.sort(([a], [b]) => {
    const ia = ORDER.indexOf(a), ib = ORDER.indexOf(b);
    return (ia === -1 ? ORDER.length : ia) - (ib === -1 ? ORDER.length : ib);
  });
  const header = yaml.dump(Object.fromEntries(entries), { lineWidth: -1, noRefs: true, quotingType: "'", forceQuotes: false, sortKeys: false });
  return `---\n${header}---\n${body.replace(/\r\n/g, '\n').trimEnd()}\n`;
}

/** Same restrictions as kbol/core.py: no anchors, aliases or merge keys; dates stay text. */
export function parseRecord(text: string): { header: Record<string, unknown>; body: string } {
  const normalized = text.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(normalized);
  if (!m) throw new Error('El registro no tiene cabecera YAML entre ---');
  if (/(^|\s)[&*][A-Za-z0-9_-]+|<<:/m.test(m[1]!)) throw new Error('La cabecera usa anclas, alias o fusiones YAML');
  const header = yaml.load(m[1]!, { schema: yaml.JSON_SCHEMA });
  if (!header || typeof header !== 'object' || Array.isArray(header)) throw new Error('La cabecera no es un mapa');
  return { header: header as Record<string, unknown>, body: m[2] ?? '' };
}
