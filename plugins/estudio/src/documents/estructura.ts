/** `estructura-v1`, generic profile, as produced by KBOL's tools/di (generica.py). Only what the app reads is typed. */
export type Region = { p: number; r: [string, string, string, string] };
export type PartType = 'resumen' | 'introduccion' | 'trabajos_relacionados' | 'metodo' | 'experimentos' | 'resultados'
  | 'conclusiones' | 'referencias' | 'anexo' | 'agradecimientos' | null;

export interface EstructuraUnit {
  clave: string;
  paginas: number[];
  regiones?: Region[];
  texto: string;
  titulo?: string | null;
  numero?: string | null;
  ruta?: string[];
  tipo?: PartType;
  leyenda?: string | null;
  referencias?: string[];
}

export interface EstructuraV1 {
  perfil: 'estructura-v1';
  original_sha256: string;
  paginas: { p: number; ancho?: number; alto?: number }[];
  unidades: EstructuraUnit[];
  referencias?: { clave: string; texto: string; paginas?: number[]; seccion?: string }[];
  avisos?: string[];
}

export type UnitKind = 'seccion' | 'tabla' | 'figura';

/** The kind lives in the key's suffix: `seccion=N;pagina=P`, `seccion=N;tabla=M`, `seccion=N;figura=M`. */
export function unitKind(clave: string): UnitKind {
  if (/;tabla=\d+$/.test(clave)) return 'tabla';
  if (/;figura=\d+$/.test(clave)) return 'figura';
  return 'seccion';
}

/** Text of a page as `kbol citas` reads it: every unit on that page, tables and figures included. Null if the page does not exist. */
export function pageText(estructura: EstructuraV1, page: number): string | null {
  if (!estructura.paginas.some(p => p.p === page)) return null;
  return estructura.unidades.filter(u => u.paginas.includes(page)).map(u => u.texto).join('\n');
}

export function parseEstructura(value: unknown): EstructuraV1 {
  const e = value as Partial<EstructuraV1> | null;
  if (!e || typeof e !== 'object' || e.perfil !== 'estructura-v1') throw new Error('La representación no es estructura-v1');
  if (typeof e.original_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(e.original_sha256)) throw new Error('estructura-v1 sin huella del original');
  if (!Array.isArray(e.paginas) || !Array.isArray(e.unidades)) throw new Error('estructura-v1 sin páginas o unidades');
  for (const u of e.unidades) {
    if (!u || typeof u.clave !== 'string' || typeof u.texto !== 'string' || !Array.isArray(u.paginas)) throw new Error('estructura-v1 con una unidad mal formada');
  }
  return e as EstructuraV1;
}

/** «2.1 Método»: the number once, even when the extracted title already starts with it. */
export function sectionLabel(numero: string | null | undefined, titulo: string | null | undefined): string {
  const t = (titulo ?? '').trim();
  const n = (numero ?? '').trim();
  if (!n) return t;
  if (!t) return n;
  return t === n || t.startsWith(`${n} `) || t.startsWith(`${n}.`) ? t : `${n} ${t}`;
}
