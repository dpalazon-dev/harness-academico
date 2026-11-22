import { firstJsonObject } from '../practice/model.ts';
import { LIMITE_PROPUESTA, MAX_PROPUESTAS, type Propuesta } from './types.ts';

/* What the tutor may offer with a margin comment (ticket 12d), read from the very answer of the call that wrote the comment:
 * there is no call of its own. The model writes the comment and, at the end, one `<propuestas>` tag with a small JSON object;
 * in the proactive read, the same object is the `propuestas` key of its JSON answer. Everything here is strict and quiet: what
 * does not validate is dropped, and the comment is shown as plain text. Nothing here writes anywhere. */

const ABRE = '<propuestas>', CIERRA = '</propuestas>';

/** The comment as David reads it, and the JSON the model attached (null when absent or unreadable). The tag never reaches the
 * visible text, even when it is malformed or was cut short: markup in a margin note would be worse than a lost proposal. */
export function separarPropuestas(raw: string): { texto: string; json: unknown | null } {
  const desde = raw.lastIndexOf(ABRE);
  if (desde === -1) return { texto: raw.trim(), json: null };
  const hasta = raw.indexOf(CIERRA, desde);
  const dentro = raw.slice(desde + ABRE.length, hasta === -1 ? raw.length : hasta);
  const despues = hasta === -1 ? '' : raw.slice(hasta + CIERRA.length);
  const texto = `${raw.slice(0, desde)}${despues}`.trim();
  return { texto, json: hasta === -1 ? null : (firstJsonObject(dentro) ?? null) };
}

/** What the validator needs from the notebook and the store, so it holds no state of its own. */
export interface ContextoPropuestas {
  newId(): string;
  /** The quote and page of the paragraph the comment hangs from, when it quotes a page of the notebook's source; else null. */
  cita: { documentId: string; pagina: number; cita: string } | null;
  /** The title of a unit or notebook he can open, or null when it does not exist (or is the notebook itself). */
  destino(tipo: 'unidad' | 'cuaderno', id: string): { titulo: string } | null;
  /** What the comment already carries, decided ones included. */
  existentes: readonly Propuesta[];
}

const L = LIMITE_PROPUESTA;
const plano = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** Text within its limit, without cutting: a proposal that does not fit is refused rather than truncated. */
function dentroDe(v: unknown, max: number, linea: boolean): string | null {
  if (typeof v !== 'string') return null;
  const t = (linea ? v.replace(/\s+/g, ' ') : v).trim();
  return t && t.length <= max && !t.includes(ABRE) ? t : null;
}
const clave = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** The proposals a model answer can add to a comment: at most one of each kind pending, never the same text twice (even after he
 * discarded it), and six in all. Each proposal is checked on its own: a bad one does not take the others down. */
export function validarPropuestas(json: unknown, ctx: ContextoPropuestas): Propuesta[] {
  if (!plano(json)) return [];
  const out: Propuesta[] = [];
  const todas = () => [...ctx.existentes, ...out];
  const sitio = () => todas().length < MAX_PROPUESTAS;
  const pendiente = (tipo: Propuesta['tipo']) => todas().some(p => p.tipo === tipo && p.estado === 'pendiente');
  const repetida = (texto: string) => todas().some(p => clave(p.tipo === 'recuperacion' ? p.pregunta : p.tipo === 'hecho' ? p.afirmacion : `${p.destino.tipo} ${p.destino.id}`) === clave(texto));

  const r = json.recuperacion;
  if (plano(r) && sitio() && !pendiente('recuperacion')) {
    const pregunta = dentroDe(r.pregunta, L.pregunta, true), respuesta = dentroDe(r.respuesta, L.respuesta, false);
    if (pregunta && respuesta && clave(pregunta) !== clave(respuesta) && !repetida(pregunta)) out.push({ id: ctx.newId(), tipo: 'recuperacion', estado: 'pendiente', pregunta, respuesta });
  }
  const h = json.hecho;
  if (plano(h) && ctx.cita && sitio() && !pendiente('hecho')) {
    const afirmacion = dentroDe(h.afirmacion, L.afirmacion, true);
    if (afirmacion && !repetida(afirmacion)) out.push({ id: ctx.newId(), tipo: 'hecho', estado: 'pendiente', afirmacion, ...ctx.cita });
  }
  const c = json.conexion;
  if (plano(c) && sitio() && !pendiente('conexion') && (c.tipo === 'unidad' || c.tipo === 'cuaderno') && typeof c.id === 'string') {
    const destino = ctx.destino(c.tipo, c.id);
    const motivo = c.motivo === undefined ? '' : dentroDe(c.motivo, L.motivo, true);
    if (destino && motivo !== null && !repetida(`${c.tipo} ${c.id}`)) out.push({ id: ctx.newId(), tipo: 'conexion', estado: 'pendiente', destino: { tipo: c.tipo, id: c.id }, titulo: destino.titulo.slice(0, L.titulo), motivo });
  }
  return out;
}
