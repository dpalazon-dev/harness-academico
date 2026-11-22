import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fields, id, text } from '../study/schema.ts';
import type { StudyStore } from '../study/store.ts';
import { StudyError } from '../study/types.ts';
import { readArtifact, readEstructura } from './almacen.ts';
import { verifyQuote, type QuoteCheck } from './citas.ts';
import { sectionLabel, unitKind, type EstructuraUnit, type EstructuraV1, type PartType } from './estructura.ts';
import type { StudyDocument } from './types.ts';
import { comprobarKbol, errorDeUv } from '../kbol-requisitos.ts';

export interface DocumentConfig {
  /** KBOL checkout; Document Intelligence runs from `<kbolDir>/tools/di`. */
  kbolDir: string;
  /** Content-addressed DI store shared with KBOL's citation resolver. */
  almacen: string;
  /** `uv` executable: a desktop app may not inherit the shell PATH. */
  uv: string;
  timeoutMs: number;
}

export function documentConfig(env: NodeJS.ProcessEnv = process.env, home = env.USERPROFILE ?? env.HOME ?? '.'): DocumentConfig {
  return {
    kbolDir: env.ESTUDIO_KBOL_DIR ?? path.join(home, 'KBOL'),
    almacen: env.KBOL_ALMACEN ?? path.join(home, '.kbol', 'learning', 'almacen'),
    uv: env.ESTUDIO_UV ?? 'uv',
    timeoutMs: 15 * 60 * 1000,
  };
}

/** What `python -m di incorporar` prints on stdout (KBOL tools/di/di/incorporar.py). Only the fields used here. */
interface IncorporarOutput {
  original: { sha256: string; bytes: number };
  docling?: { sha256?: string; paginas?: number };
  estructura: { sha256: string };
  contraste?: { resumen?: { recuerdo_documento?: number; respaldo_documento?: number; paginas_sin_capa_de_texto?: number[] } };
  revisar?: string[];
}

const tail = (s: string) => s.trim().split(/\r?\n/).slice(-6).join('\n');

/** `incorporar` prints one JSON object with `indent=1`; anything a dependency printed before it is skipped. */
export function parseIncorporarStdout(stdout: string): IncorporarOutput {
  let out: IncorporarOutput;
  try { out = JSON.parse(stdout); }
  catch {
    const start = stdout.search(/^\{\s*$/m);
    if (start === -1) throw new Error('no hay JSON en la salida');
    out = JSON.parse(stdout.slice(start));
  }
  if (!/^[0-9a-f]{64}$/.test(out?.original?.sha256 ?? '') || !/^[0-9a-f]{64}$/.test(out?.estructura?.sha256 ?? '')) throw new Error('faltan las huellas');
  return out;
}

/** Stops the whole process tree: on Windows, killing `uv` alone would leave Docling's Python running. */
function killTree(child: childProcess.ChildProcess): void {
  if (process.platform === 'win32' && child.pid !== undefined) {
    childProcess.spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
  } else child.kill();
}

export function runIncorporar(file: string, config: DocumentConfig, signal: AbortSignal): Promise<IncorporarOutput> {
  if (signal.aborted) return Promise.reject(new Error('Estudio está desactivado.'));
  try { comprobarKbol('Incorporar un PDF', config, path.join('tools', 'di')); }
  catch (error) { return Promise.reject(error); }
  return new Promise((resolve, reject) => {
    const child = childProcess.spawn(config.uv, ['run', '--no-sync', 'python', '-m', 'di', 'incorporar', file], {
      cwd: path.join(config.kbolDir, 'tools', 'di'),
      env: { ...process.env, KBOL_ALMACEN: config.almacen, PYTHONIOENCODING: 'utf-8' },
      windowsHide: true,
    });
    let stdout = '', stderr = '';
    child.stdout?.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr?.setEncoding('utf8').on('data', chunk => { stderr = (stderr + chunk).slice(-20000); });
    const stop = () => killTree(child);
    const timer = setTimeout(stop, config.timeoutMs);
    signal.addEventListener('abort', stop, { once: true });
    child.on('error', error => { clearTimeout(timer); reject(new Error(errorDeUv(config.uv, error) ?? `No se pudo lanzar Document Intelligence (${config.uv}): ${error.message}`)); });
    child.on('close', code => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      if (code !== 0) return reject(new Error(`Document Intelligence terminó con código ${code}${stderr ? `:\n${tail(stderr)}` : ''}`));
      try { resolve(parseIncorporarStdout(stdout)); }
      catch (error) { reject(new Error(`Document Intelligence devolvió una salida no válida: ${(error as Error).message}`)); }
    });
  });
}

export interface SectionSummary { clave: string; titulo: string | null; numero: string | null; ruta: string[]; tipo: PartType; paginas: number[] }
export interface FloatSummary { clave: string; leyenda: string | null; paginas: number[] }
export interface DocumentDetail {
  document: StudyDocument;
  secciones: SectionSummary[];
  tablas: FloatSummary[];
  figuras: FloatSummary[];
  referencias: { clave: string; texto: string }[];
  avisos: string[];
}

/** One page as the reader shows it: the structure's units on that page, in order, as extracted. */
export interface PageBlock { clave: string; kind: 'seccion' | 'tabla' | 'figura'; heading: string | null; text: string }
export interface PageView { documentId: string; title: string; page: number; total: number; blocks: PageBlock[] }

export interface DocumentService {
  list(): StudyDocument[];
  page(input: unknown): PageView;
  incorporate(input: unknown): StudyDocument;
  detail(input: unknown): DocumentDetail;
  verify(input: unknown): QuoteCheck;
  /** Text of the cited sections, or of the abstract, introduction and conclusions, capped for a model prompt.
   * Throws when the document is unavailable or the locator matches nothing: a task must never silently lose its grounding. */
  excerpt(documentId: string, locator: string | undefined, max: number): string;
  /** Throws when a locator (section number or key, or a page as "p. N") matches no section of a readable document.
   * An unreadable document is not judged here: practising reports it. */
  checkLocator(documentId: string, locator: string): void;
  /** Resolves once queued incorporations have finished; for orderly shutdown and tests. */
  idle(): Promise<void>;
}

export interface DocumentOptions {
  config: DocumentConfig; now: () => string; newId: () => string; signal: AbortSignal; onChange: () => void;
  /** Space a new document belongs to: the active one. */
  area?: () => string | null;
}

const SUMMARY_TYPES = new Set<PartType>(['resumen', 'introduccion', 'conclusiones']);

export function createDocumentService(store: StudyStore, options: DocumentOptions): DocumentService {
  const { config, now, newId, signal, onChange } = options;
  let queue: Promise<void> = Promise.resolve();

  // A process that died mid-incorporation left its record behind; it will never finish on its own.
  for (const doc of store.listDocuments().filter(d => d.status === 'procesando')) {
    store.saveDocument({ ...doc, revision: doc.revision + 1, status: 'error', error: 'Incorporación interrumpida: vuelve a incorporarlo.', finishedAt: now() }, doc.revision);
  }

  function ready(documentId: string): { doc: StudyDocument; estructura: EstructuraV1 } {
    const doc = store.getDocument(documentId);
    if (!doc) throw new StudyError('NOT_FOUND', `Document ${documentId} does not exist`);
    if (doc.status !== 'listo') throw new StudyError('INVALID_TRANSITION', `El documento está ${doc.status}`);
    const estructura = readEstructura(config.almacen, doc.estructuraSha256!);
    if (estructura.original_sha256 !== doc.original!.sha256) throw new StudyError('CORRUPT_DATA', 'La representación no deriva del original de este documento');
    return { doc, estructura };
  }

  async function incorporateNow(doc: StudyDocument): Promise<void> {
    let next: StudyDocument;
    try {
      const out = await runIncorporar(doc.path, config, signal);
      const resumen = out.contraste?.resumen;
      next = {
        ...doc, status: 'listo', finishedAt: now(), error: null,
        original: { sha256: out.original.sha256, bytes: out.original.bytes },
        doclingSha256: out.docling?.sha256 ?? null, estructuraSha256: out.estructura.sha256, paginas: out.docling?.paginas ?? null,
        contraste: resumen ? { recuerdo: resumen.recuerdo_documento ?? 0, respaldo: resumen.respaldo_documento ?? 0, paginasSinTexto: resumen.paginas_sin_capa_de_texto ?? [] } : null,
        revisar: (out.revisar ?? []).map(line => String(line).slice(0, 2000)),
      };
      if (readEstructura(config.almacen, out.estructura.sha256).original_sha256 !== out.original.sha256) throw new Error('la representación no deriva de este original');
    } catch (error) {
      next = { ...doc, status: 'error', finishedAt: now(), error: (error as Error).message.slice(0, 4000) };
    }
    if (signal.aborted) return;
    const current = store.getDocument(doc.id)!;
    // The space may have changed while it was being incorporated; the current record's wins.
    try { store.saveDocument({ ...next, areaId: current.areaId, revision: current.revision + 1 }, current.revision); }
    catch (error) {
      // The result itself could not be stored; record why instead of leaving the document processing forever.
      store.saveDocument({ ...doc, areaId: current.areaId, revision: current.revision + 1, status: 'error', finishedAt: now(), error: `No se pudo guardar el resultado: ${(error as Error).message}`.slice(0, 4000) }, current.revision);
    }
    onChange();
  }

  return {
    list: () => store.listDocuments().sort((a, b) => b.startedAt.localeCompare(a.startedAt)),

    incorporate(input) {
      const r = fields(input, ['path', 'title'], 'input');
      const file = text(r.path, 2000, 'input.path', { required: true }).trim().replace(/^"(.*)"$/, '$1');
      if (!path.isAbsolute(file)) throw new StudyError('INVALID_INPUT', 'Indica la ruta completa del PDF');
      if (/^[\\/]{2}/.test(file)) throw new StudyError('INVALID_INPUT', 'Solo se incorporan archivos locales, no rutas de red');
      if (!/\.pdf$/i.test(file)) throw new StudyError('INVALID_INPUT', 'Solo se incorporan archivos PDF');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new StudyError('NOT_FOUND', `No existe el archivo ${file}`);
      const title = r.title === undefined || String(r.title).trim() === '' ? path.basename(file, path.extname(file)) : text(r.title, 500, 'input.title');
      const doc = store.saveDocument({
        id: newId(), revision: 1, title, path: file, status: 'procesando', error: null, startedAt: now(), finishedAt: null,
        original: null, doclingSha256: null, estructuraSha256: null, paginas: null, contraste: null, revisar: [], areaId: options.area?.() ?? null,
      }, null);
      // A failure of one incorporation must never stop the ones queued after it.
      queue = queue.then(() => incorporateNow(doc)).catch(() => {});
      return doc;
    },

    page(input) {
      const r = fields(input, ['id', 'page'], 'input');
      const { doc, estructura } = ready(id(r.id, 'input.id'));
      const pages = estructura.paginas.map(p => p.p).sort((a, b) => a - b);
      const total = pages.at(-1) ?? 0;
      if (!Number.isSafeInteger(r.page) || !pages.includes(r.page as number)) throw new StudyError('INVALID_INPUT', `La página debe estar entre 1 y ${total}`);
      const page = r.page as number;
      const blocks = estructura.unidades.filter(u => u.paginas.includes(page)).map(u => {
        const kind = unitKind(u.clave);
        const heading = kind === 'seccion' ? sectionLabel(u.numero, u.titulo) || null : u.leyenda ?? null;
        return { clave: u.clave, kind, heading, text: u.texto };
      });
      return { documentId: doc.id, title: doc.title, page, total, blocks };
    },

    detail(input) {
      const r = fields(input, ['id'], 'input');
      const { doc, estructura } = ready(id(r.id, 'input.id'));
      const secciones: SectionSummary[] = [], tablas: FloatSummary[] = [], figuras: FloatSummary[] = [];
      for (const u of estructura.unidades) {
        const kind = unitKind(u.clave);
        if (kind === 'seccion') secciones.push({ clave: u.clave, titulo: u.titulo ?? null, numero: u.numero ?? null, ruta: u.ruta ?? [], tipo: u.tipo ?? null, paginas: u.paginas });
        else (kind === 'tabla' ? tablas : figuras).push({ clave: u.clave, leyenda: u.leyenda ?? null, paginas: u.paginas });
      }
      return { document: doc, secciones, tablas, figuras, referencias: (estructura.referencias ?? []).map(x => ({ clave: x.clave, texto: x.texto })), avisos: estructura.avisos ?? [] };
    },

    verify(input) {
      const r = fields(input, ['documentId', 'page', 'quote'], 'input');
      const { doc, estructura } = ready(id(r.documentId, 'input.documentId'));
      if (!Number.isSafeInteger(r.page) || (r.page as number) < 1) throw new StudyError('INVALID_INPUT', 'page must be a positive integer');
      const check = verifyQuote(estructura, r.page as number, text(r.quote, 4000, 'input.quote'));
      if (check.estado !== 'resuelta') return check;
      try { readArtifact(config.almacen, doc.original!.sha256); }
      catch (error) {
        const missing = /no está en el almacén/.test((error as Error).message);
        return { estado: missing ? 'no_comprobable' : 'rota', motivo: missing ? 'estructura conforme; original no disponible' : 'el original del almacén no tiene la huella de la fuente' };
      }
      return check;
    },

    excerpt(documentId, locator, max) {
      let estructura: EstructuraV1;
      try { estructura = ready(documentId).estructura; }
      catch (error) { throw new StudyError('INVALID_TRANSITION', `El documento vinculado no está disponible (${(error as Error).message}); vuelve a incorporarlo o quítalo de la unidad.`); }
      const sections = estructura.unidades.filter(u => unitKind(u.clave) === 'seccion');
      const chosen = locator ? located(sections, locator) : sections.filter(u => SUMMARY_TYPES.has(u.tipo ?? null));
      const picked = chosen.length > 0 ? chosen : sections.slice(0, 3);
      const joined = picked.map(u => u.texto).join('\n\n');
      return joined.length > max ? `${joined.slice(0, max)}\n[…]` : joined;
    },

    checkLocator(documentId, locator) {
      let estructura: EstructuraV1;
      try { estructura = ready(documentId).estructura; } catch { return; }
      located(estructura.unidades.filter(u => unitKind(u.clave) === 'seccion'), locator);
    },

    idle: () => queue,
  };
}

/** A page as the reader shows it: "p. 2", "pág. 2", "página 2". */
const PAGE_LOCATOR = /^p(?:á|a)?g?(?:ina)?\.?\s*(\d+)$/i;

/** Sections a locator names: by key, by number (and its subsections) or by page. Throws when it names none. */
function located(sections: EstructuraUnit[], locator: string): EstructuraUnit[] {
  const page = PAGE_LOCATOR.exec(locator.trim());
  if (page) {
    const n = Number(page[1]);
    const onPage = sections.filter(u => u.paginas.includes(n));
    if (onPage.length === 0) throw new StudyError('INVALID_INPUT', `La página ${n} no tiene secciones en el documento vinculado`);
    return onPage;
  }
  const chosen = sections.filter(u => u.clave === locator || (u.numero !== undefined && u.numero !== null && (u.numero === locator || u.numero.startsWith(`${locator}.`))));
  if (chosen.length === 0) throw new StudyError('INVALID_INPUT', `La sección ${locator} no existe en el documento vinculado`);
  return chosen;
}
