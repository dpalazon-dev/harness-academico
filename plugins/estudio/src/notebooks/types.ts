import { areaRef, fields, id, text } from '../study/schema.ts';
import { StudyError } from '../study/types.ts';

/** The light notation of the method handoff: a symbol says what a note is for, never that it is true. */
export const SYMBOLS = ['I', '→', '≠', '#', '★', 'Δ', '?', '⚠', 'Ex:', 'A:', 'Ref:', 'C:', 'CE:', '~', 'X', 'D:', '+', '−'] as const;
export type NoteSymbol = typeof SYMBOLS[number];
export const SYMBOL_LABEL: Record<NoteSymbol, string> = {
  'I': 'Idea o afirmación', '→': 'Relación o mecanismo', '≠': 'Distinción', '#': 'Dato o cifra', '★': 'Importante',
  'Δ': 'Cambio en mi comprensión', '?': 'Duda', '⚠': 'Cautela o verificación pendiente', 'Ex:': 'Ejemplo', 'A:': 'Aplicación',
  'Ref:': 'Referencia', 'C:': 'Condición o supuesto', 'CE:': 'Contraejemplo', '~': 'Aproximación', 'X': 'Error detectado',
  'D:': 'Decisión', '+': 'Ventaja', '−': 'Coste o inconveniente',
};

/** A paragraph of the page starts with a symbol of the notation followed by one space: «? ¿Por qué?». What follows the
 * space is kept as written, so `composeNote(deduceNote(raw))` gives back exactly `raw`. The symbol must open the
 * paragraph: no indentation, no newline in place of the space, nothing stuck to it. */
export function deduceNote(raw: string): { symbol: NoteSymbol | null; text: string } {
  const symbol = SYMBOLS.find(s => raw.startsWith(`${s} `));
  return symbol ? { symbol, text: raw.slice(symbol.length + 1) } : { symbol: null, text: raw };
}

/** The paragraph as David sees and types it: the symbol, one space and the text. */
export function composeNote(symbol: NoteSymbol | null, text: string): string {
  return symbol ? `${symbol} ${text}` : text;
}

/** Source note, durable knowledge note or synthesis (handoff, section 7); «libre» when it is none of them yet. */
export type NotebookKind = 'fuente' | 'conocimiento' | 'sintesis' | 'libre';
export const NOTEBOOK_KINDS: readonly NotebookKind[] = ['fuente', 'conocimiento', 'sintesis', 'libre'];

export type Block =
  | { id: string; kind: 'nota'; symbol: NoteSymbol | null; text: string; locator: string; quote: string }
  /** Incorrect representation → its cause → the correction (handoff 2, section 14). */
  | { id: string; kind: 'error'; wrong: string; cause: string; fix: string }
  /** A retrieval question David writes with his own expected answer; it is practised like any task. */
  | { id: string; kind: 'recuperacion'; question: string; answer: string };

/** Where a margin comment hangs: a fragment of one paragraph, found again by its text and the text around it (the same
 * selector as the citations of the core, `createTextSelector`), so it survives edits elsewhere in the page. */
export interface CommentAnchor { blockId: string; text: string; start: number; end: number; prefix: string; suffix: string }

/** What the tutor was asked: «pregunta» asks and points out; «explicacion» explains the fragment; «dibujo» draws it (ticket 12h). */
export type CommentKind = 'pregunta' | 'explicacion' | 'dibujo';
export const COMMENT_KINDS: readonly CommentKind[] = ['pregunta', 'explicacion', 'dibujo'];
export type CommentState = 'abierto' | 'atendido' | 'descartado';
export const COMMENT_STATES: readonly CommentState[] = ['abierto', 'atendido', 'descartado'];

export interface ThreadMessage { id: string; role: 'tutor' | 'david'; text: string; at: string }

/** What a comment can offer besides its text (ticket 12d). Nothing here touches the page or the knowledge base until David
 * accepts it: «pendiente» is an offer, «aceptada» is done (and carries what it made), «descartada» leaves no trace elsewhere. */
export type EstadoPropuesta = 'pendiente' | 'aceptada' | 'descartada';
export const ESTADOS_PROPUESTA: readonly EstadoPropuesta[] = ['pendiente', 'aceptada', 'descartada'];
export type Propuesta =
  /** A retrieval question and the answer the tutor expects, as a draft: accepted, it becomes David's own block after the paragraph. */
  | { id: string; tipo: 'recuperacion'; estado: EstadoPropuesta; pregunta: string; respuesta: string; bloqueId?: string }
  /** A claim of his source, with the quote and page of the paragraph it hangs from (taken from the page, never from the model):
   * accepted, it is a KBOL draft with origin tutor, waiting in «Por decidir». */
  | { id: string; tipo: 'hecho'; estado: EstadoPropuesta; afirmacion: string; documentId: string; pagina: number; cita: string; borradorId?: string }
  /** A link to a unit or notebook that existed when it was offered; it is opened, not accepted. */
  | { id: string; tipo: 'conexion'; estado: EstadoPropuesta; destino: { tipo: 'unidad' | 'cuaderno'; id: string }; titulo: string; motivo: string };
/** Proposals in one comment, in all (decided ones count), and the limits of what they carry. */
export const MAX_PROPUESTAS = 6;
export const LIMITE_PROPUESTA = { pregunta: 400, respuesta: 1200, afirmacion: 600, motivo: 200, titulo: 300 };

/** A diagram the tutor drew on request (ticket 12h): Mermaid source, hanging from the tutor message that carries it. It belongs to
 * the comment, never to `blocks` or to David's text, and he can remove it. The source is data: it is drawn in the browser by the
 * app's own renderer, with its strict security level. */
export interface Dibujo { id: string; mermaid: string; mensajeId: string }
/** Characters of one diagram, drawings in a comment, and drawings in a notebook (the ones of discarded comments do not count). */
export const MAX_DIBUJO = 3000, MAX_DIBUJOS_COMENTARIO = 4, MAX_DIBUJOS_CUADERNO = 20;

/** A comment in the margin. Lives in the notebook, apart from `blocks`: the tutor never writes in David's page. */
export interface Comment {
  id: string;
  anchor: CommentAnchor;
  /** Who wrote it: the id of a character (ticket 12g); 'tutor' in a comment from before the characters. */
  persona: string;
  /** The name of the character when it wrote the comment. It stays when David renames or deletes the character. */
  firma?: string;
  kind: CommentKind;
  state: CommentState;
  createdAt: string;
  thread: ThreadMessage[];
  /** 'proactivo': the tutor wrote it on its own while David wrote, not because he asked (ticket 12e). */
  origen?: 'proactivo';
  /** What the tutor offers with this comment (ticket 12d); absent when it offered nothing. */
  propuestas?: Propuesta[];
  /** What the tutor drew in this comment, on request (ticket 12h); absent when it drew nothing. */
  dibujos?: Dibujo[];
}

/** 'proactivo': the tutor reads while David writes and comments when he stops (the default); 'a-peticion': only when asked. */
export type NotebookMode = 'proactivo' | 'a-peticion';
export const NOTEBOOK_MODES: readonly NotebookMode[] = ['proactivo', 'a-peticion'];
/** Why the notebook is in 'a-peticion' without David having chosen it: the daily limit of proactive reads, three failures in a
 * row, or no cheap model (or no room under the limit) when he left «Solo escucha» and the tutor could not go back to reading. */
export type ModeNotice = 'tope' | 'fallos' | 'sin-modelo';
export const MODE_NOTICES: readonly ModeNotice[] = ['tope', 'fallos', 'sin-modelo'];

/** The ink of a notebook's comments: a name for a color the theme already defines (see `components/estudio/tintas.ts`), never
 * a color of its own, so it reads in every theme. 'acento' is the default and is not stored. */
export type Ink = 'acento' | 'verde' | 'ambar' | 'rojo' | 'texto';
export const INKS: readonly Ink[] = ['acento', 'verde', 'ambar', 'rojo', 'texto'];
export const DEFAULT_INK: Ink = 'acento';
/** One line of David's own words about what the notebook is for. */
export const MAX_PURPOSE = 200;
/** The purpose that means «do not comment on your own» (ticket 12f). A fixed text, so the chip and the stored line are the same. */
export const SOLO_ESCUCHA = 'Solo escucha';

export interface Notebook {
  id: string;
  revision: number;
  title: string;
  kind: NotebookKind;
  unitId: string | null;
  documentId: string | null;
  blocks: Block[];
  createdAt: string;
  updatedAt: string;
  areaId: string | null;
  /** Margin comments; absent in a notebook that never had one. */
  comments?: Comment[];
  /** Absent means 'proactivo'. */
  modo?: NotebookMode;
  /** Set when the notebook left 'proactivo' by itself; David turning it on again clears it. */
  aviso?: ModeNotice;
  /** The mode David had when he chose «Solo escucha», restored when he leaves it. Only 'a-peticion' is stored: absent means 'proactivo'. */
  modoAntes?: 'a-peticion';
  /** What David wants from the tutor in this notebook, in his words, one line (ticket 12f). Absent when there is none. */
  proposito?: string;
  /** The ink of the comments; absent means the theme accent. */
  tinta?: Ink;
  /** The character that comments on its own here (ticket 12g); absent means the Teacher. A deleted character reads as the Teacher. */
  persona?: string;
}

export const MAX_COMMENTS = 200;
/** Blocks in a page, and the characters David can put in a title, a paragraph or a field: the limits he can actually reach. */
export const MAX_BLOCKS = 500, MAX_TITLE = 300;
/** Messages in the thread of one comment, and characters in one message. */
export const MAX_THREAD = 100, MAX_TEXT = 8000;
const LIMIT = { title: MAX_TITLE, text: MAX_TEXT, locator: 100, quote: 4000, blocks: MAX_BLOCKS, anchor: 8000, context: 200, thread: MAX_THREAD, persona: 64 };

function invalid(message: string): never { throw new StudyError('INVALID_INPUT', message); }

export function parseBlock(value: unknown, path: string): Block {
  const kind = (value as { kind?: unknown } | null)?.kind;
  if (kind === 'nota') {
    const r = fields(value, ['id', 'kind', 'symbol', 'text', 'locator', 'quote'], path);
    if (r.symbol !== null && !SYMBOLS.includes(r.symbol as NoteSymbol)) invalid(`${path}.symbol is not a known symbol`);
    return { id: id(r.id, `${path}.id`), kind, symbol: r.symbol as NoteSymbol | null, text: text(r.text, LIMIT.text, `${path}.text`),
      locator: text(r.locator ?? '', LIMIT.locator, `${path}.locator`), quote: text(r.quote ?? '', LIMIT.quote, `${path}.quote`) };
  }
  if (kind === 'error') {
    const r = fields(value, ['id', 'kind', 'wrong', 'cause', 'fix'], path);
    return { id: id(r.id, `${path}.id`), kind, wrong: text(r.wrong, LIMIT.text, `${path}.wrong`), cause: text(r.cause, LIMIT.text, `${path}.cause`), fix: text(r.fix, LIMIT.text, `${path}.fix`) };
  }
  if (kind === 'recuperacion') {
    const r = fields(value, ['id', 'kind', 'question', 'answer'], path);
    return { id: id(r.id, `${path}.id`), kind, question: text(r.question, LIMIT.text, `${path}.question`), answer: text(r.answer, LIMIT.text, `${path}.answer`) };
  }
  return invalid(`${path}.kind must be nota, error or recuperacion`);
}

function offset(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`${path} must be a non-negative integer`);
  return value as number;
}

export function parsePropuesta(value: unknown, path: string): Propuesta {
  const tipo = (value as { tipo?: unknown } | null)?.tipo;
  const estado = (value as { estado?: unknown } | null)?.estado;
  if (!ESTADOS_PROPUESTA.includes(estado as EstadoPropuesta)) invalid(`${path}.estado is not supported`);
  const e = estado as EstadoPropuesta, L = LIMITE_PROPUESTA;
  if (tipo === 'recuperacion') {
    const r = fields(value, ['id', 'tipo', 'estado', 'pregunta', 'respuesta', 'bloqueId'], path);
    return { id: id(r.id, `${path}.id`), tipo, estado: e, pregunta: text(r.pregunta, L.pregunta, `${path}.pregunta`, { required: true }), respuesta: text(r.respuesta, L.respuesta, `${path}.respuesta`, { required: true }),
      ...(r.bloqueId !== undefined ? { bloqueId: id(r.bloqueId, `${path}.bloqueId`) } : {}) };
  }
  if (tipo === 'hecho') {
    const r = fields(value, ['id', 'tipo', 'estado', 'afirmacion', 'documentId', 'pagina', 'cita', 'borradorId'], path);
    if (!Number.isSafeInteger(r.pagina) || (r.pagina as number) < 1) invalid(`${path}.pagina must be a positive integer`);
    return { id: id(r.id, `${path}.id`), tipo, estado: e, afirmacion: text(r.afirmacion, L.afirmacion, `${path}.afirmacion`, { required: true }), documentId: id(r.documentId, `${path}.documentId`),
      pagina: r.pagina as number, cita: text(r.cita, LIMIT.quote, `${path}.cita`, { required: true }), ...(r.borradorId !== undefined ? { borradorId: id(r.borradorId, `${path}.borradorId`) } : {}) };
  }
  if (tipo === 'conexion') {
    const r = fields(value, ['id', 'tipo', 'estado', 'destino', 'titulo', 'motivo'], path);
    const d = fields(r.destino, ['tipo', 'id'], `${path}.destino`);
    if (d.tipo !== 'unidad' && d.tipo !== 'cuaderno') invalid(`${path}.destino.tipo must be unidad or cuaderno`);
    return { id: id(r.id, `${path}.id`), tipo, estado: e, destino: { tipo: d.tipo, id: id(d.id, `${path}.destino.id`) }, titulo: text(r.titulo, L.titulo, `${path}.titulo`), motivo: text(r.motivo, L.motivo, `${path}.motivo`) };
  }
  return invalid(`${path}.tipo must be recuperacion, hecho or conexion`);
}

export function parseDibujo(value: unknown, path: string): Dibujo {
  const r = fields(value, ['id', 'mermaid', 'mensajeId'], path);
  return { id: id(r.id, `${path}.id`), mermaid: text(r.mermaid, MAX_DIBUJO, `${path}.mermaid`, { required: true }), mensajeId: id(r.mensajeId, `${path}.mensajeId`) };
}

export function parseComment(value: unknown, path: string): Comment {
  const r = fields(value, ['id', 'anchor', 'persona', 'firma', 'kind', 'state', 'createdAt', 'thread', 'origen', 'propuestas', 'dibujos'], path);
  if (r.dibujos !== undefined && (!Array.isArray(r.dibujos) || r.dibujos.length > MAX_DIBUJOS_COMENTARIO)) invalid(`${path}.dibujos must be a list of at most ${MAX_DIBUJOS_COMENTARIO}`);
  const dibujos = r.dibujos === undefined ? undefined : (r.dibujos as unknown[]).map((d, i) => parseDibujo(d, `${path}.dibujos[${i}]`));
  if (dibujos && new Set(dibujos.map(d => d.id)).size !== dibujos.length) invalid(`${path}.dibujos have repeated ids`);
  if (r.propuestas !== undefined && (!Array.isArray(r.propuestas) || r.propuestas.length > MAX_PROPUESTAS)) invalid(`${path}.propuestas must be a list of at most ${MAX_PROPUESTAS}`);
  const propuestas = r.propuestas === undefined ? undefined : (r.propuestas as unknown[]).map((p, i) => parsePropuesta(p, `${path}.propuestas[${i}]`));
  if (propuestas && new Set(propuestas.map(p => p.id)).size !== propuestas.length) invalid(`${path}.propuestas have repeated ids`);
  if (r.origen !== undefined && r.origen !== 'proactivo') invalid(`${path}.origen is not supported`);
  const a = fields(r.anchor, ['blockId', 'text', 'start', 'end', 'prefix', 'suffix'], `${path}.anchor`);
  if (!COMMENT_KINDS.includes(r.kind as CommentKind)) invalid(`${path}.kind is not supported`);
  if (!COMMENT_STATES.includes(r.state as CommentState)) invalid(`${path}.state is not supported`);
  if (!Array.isArray(r.thread) || r.thread.length > LIMIT.thread) invalid(`${path}.thread must be a list of at most ${LIMIT.thread}`);
  return {
    id: id(r.id, `${path}.id`),
    anchor: {
      blockId: id(a.blockId, `${path}.anchor.blockId`), text: text(a.text, LIMIT.anchor, `${path}.anchor.text`, { required: true }),
      start: offset(a.start, `${path}.anchor.start`), end: offset(a.end, `${path}.anchor.end`),
      prefix: text(a.prefix, LIMIT.context, `${path}.anchor.prefix`), suffix: text(a.suffix, LIMIT.context, `${path}.anchor.suffix`),
    },
    persona: text(r.persona, LIMIT.persona, `${path}.persona`, { required: true }), kind: r.kind as CommentKind, state: r.state as CommentState,
    createdAt: text(r.createdAt, 40, `${path}.createdAt`),
    ...(r.firma ? { firma: text(r.firma, LIMIT.persona, `${path}.firma`) } : {}),
    ...(r.origen === 'proactivo' ? { origen: 'proactivo' as const } : {}),
    ...(propuestas && propuestas.length > 0 ? { propuestas } : {}),
    ...(dibujos && dibujos.length > 0 ? { dibujos } : {}),
    thread: r.thread.map((m, i) => {
      const t = fields(m, ['id', 'role', 'text', 'at'], `${path}.thread[${i}]`);
      if (t.role !== 'tutor' && t.role !== 'david') invalid(`${path}.thread[${i}].role must be tutor or david`);
      return { id: id(t.id, `${path}.thread[${i}].id`), role: t.role, text: text(t.text, LIMIT.text, `${path}.thread[${i}].text`, { required: true }), at: text(t.at, 40, `${path}.thread[${i}].at`) };
    }),
  };
}

export function parseNotebook(value: unknown): Notebook {
  const r = fields(value, ['id', 'revision', 'title', 'kind', 'unitId', 'documentId', 'blocks', 'createdAt', 'updatedAt', 'areaId', 'comments', 'modo', 'aviso', 'modoAntes', 'proposito', 'tinta', 'persona'], 'notebook');
  if (r.modoAntes !== undefined && r.modoAntes !== 'a-peticion') invalid('notebook.modoAntes is not supported');
  if (r.modo !== undefined && !NOTEBOOK_MODES.includes(r.modo as NotebookMode)) invalid('notebook.modo is not supported');
  if (r.aviso !== undefined && !MODE_NOTICES.includes(r.aviso as ModeNotice)) invalid('notebook.aviso is not supported');
  if (r.proposito !== undefined && (typeof r.proposito !== 'string' || r.proposito.length > MAX_PURPOSE)) invalid(`notebook.proposito must be text of at most ${MAX_PURPOSE} characters`);
  if (r.tinta !== undefined && !INKS.includes(r.tinta as Ink)) invalid('notebook.tinta is not supported');
  if (!Number.isSafeInteger(r.revision) || (r.revision as number) < 1) invalid('notebook.revision must be a positive integer');
  if (!NOTEBOOK_KINDS.includes(r.kind as NotebookKind)) invalid('notebook.kind is not supported');
  if (!Array.isArray(r.blocks) || r.blocks.length > LIMIT.blocks) invalid(`notebook.blocks must be a list of at most ${LIMIT.blocks}`);
  const blocks = r.blocks.map((b, i) => parseBlock(b, `notebook.blocks[${i}]`));
  if (new Set(blocks.map(b => b.id)).size !== blocks.length) invalid('notebook.blocks have repeated ids');
  if (r.comments !== undefined && (!Array.isArray(r.comments) || r.comments.length > MAX_COMMENTS)) invalid(`notebook.comments must be a list of at most ${MAX_COMMENTS}`);
  const comments = r.comments === undefined ? undefined : (r.comments as unknown[]).map((c, i) => parseComment(c, `notebook.comments[${i}]`));
  if (comments && new Set(comments.map(c => c.id)).size !== comments.length) invalid('notebook.comments have repeated ids');
  return {
    id: id(r.id, 'notebook.id'), revision: r.revision as number, title: text(r.title, LIMIT.title, 'notebook.title', { required: true }).trim(),
    kind: r.kind as NotebookKind, unitId: r.unitId === null ? null : id(r.unitId, 'notebook.unitId'),
    documentId: r.documentId === null ? null : id(r.documentId, 'notebook.documentId'), blocks,
    createdAt: text(r.createdAt, 40, 'notebook.createdAt'), updatedAt: text(r.updatedAt, 40, 'notebook.updatedAt'),
    areaId: areaRef(r.areaId, 'notebook.areaId'),
    ...(comments ? { comments } : {}),
    ...(r.modo === 'a-peticion' ? { modo: 'a-peticion' as const } : {}),
    ...(r.aviso ? { aviso: r.aviso as ModeNotice } : {}),
    ...(r.modoAntes === 'a-peticion' ? { modoAntes: 'a-peticion' as const } : {}),
    ...(r.proposito ? { proposito: r.proposito as string } : {}),
    ...(r.tinta && r.tinta !== DEFAULT_INK ? { tinta: r.tinta as Ink } : {}),
    ...(r.persona ? { persona: id(r.persona, 'notebook.persona') } : {}),
  };
}

const KIND_TITLE: Record<NotebookKind, string> = { fuente: 'Nota de fuente', conocimiento: 'Nota de conocimiento', sintesis: 'Síntesis', libre: 'Cuaderno' };

/** Plain Markdown in David's notation, for his own files or another tool. */
export function notebookMarkdown(nb: Notebook, context: { unit?: string; document?: string } = {}): string {
  const out = [`# ${nb.title}`, '', `*${KIND_TITLE[nb.kind]}*${context.unit ? ` · unidad: ${context.unit}` : ''}${context.document ? ` · fuente: ${context.document}` : ''}`, ''];
  for (const b of nb.blocks) {
    if (b.kind === 'nota') {
      out.push(`- ${b.symbol ? `${b.symbol} ` : ''}${b.text.trim()}${b.locator ? ` (${b.locator})` : ''}`);
      if (b.quote) out.push(`  > ${b.quote.trim().replace(/\n/g, '\n  > ')}`);
    } else if (b.kind === 'error') {
      out.push(`- X ${b.wrong.trim()}`, `  - Causa: ${b.cause.trim()}`, `  - Corrección: ${b.fix.trim()}`);
    } else out.push(`- Pregunta: ${b.question.trim()}`, `  - Respuesta: ${b.answer.trim()}`);
  }
  return `${out.join('\n')}\n`;
}

const tsv = (s: string) => s.replace(/[\t\r]/g, ' ').replace(/\n/g, '<br>');
const tag = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60);

/** Anki's text import with a stable GUID per question, so re-importing updates instead of duplicating. Only retrieval
 * questions go: the handoff warns against turning everything into flashcards. */
export function ankiExport(notebooks: readonly Notebook[]): { text: string; count: number } {
  const rows: string[] = [];
  for (const nb of notebooks) {
    for (const b of nb.blocks) {
      if (b.kind !== 'recuperacion' || !b.question.trim() || !b.answer.trim()) continue;
      rows.push([`estudio-${b.id}`, tsv(b.question.trim()), tsv(b.answer.trim()), `estudio ${tag(nb.title) || 'cuaderno'}`].join('\t'));
    }
  }
  return { text: ['#separator:tab', '#html:true', '#guid column:1', '#tags column:4', ...rows].join('\n') + '\n', count: rows.length };
}

/** One search document per notebook, so the tutor finds David's own notes with estudio_buscar. */
export function notebookSearchText(nb: Notebook): string {
  return notebookMarkdown(nb);
}
