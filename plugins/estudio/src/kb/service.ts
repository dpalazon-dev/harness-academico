import { randomUUID } from 'node:crypto';
import { parsePdfAnchor } from '../documents/citas.ts';
import type { DocumentService } from '../documents/incorporar.ts';
import type { StudyDocument } from '../documents/types.ts';
import { fields, id, text } from '../study/schema.ts';
import type { StudyStore } from '../study/store.ts';
import { StudyError } from '../study/types.ts';
import { entidad, fuenteDerivada, fuenteOriginal, hechoFromQuote, pregunta, sintesis, type Built } from './builder.ts';
import type { KbDraft } from './drafts.ts';
import { recordPath, renderRecord } from './records.ts';
import type { KbRepo } from './repo.ts';
import { ENTITY_CLASSES, type EntityClass, type KbHecho, type KbRecord } from './types.ts';
import { nombreEstudiante } from '../identidad.ts';

export interface RegisteredSources { original: string; derivada: string }

export interface KbService {
  registerDocument(input: unknown): Promise<RegisteredSources>;
  captureFact(input: unknown, origin: 'david' | 'tutor'): Promise<KbDraft>;
  addQuestion(input: unknown, origin: 'david' | 'tutor'): Promise<KbDraft>;
  addSynthesis(input: unknown, origin: 'david' | 'tutor'): Promise<KbDraft>;
  drafts(): KbDraft[];
  confirm(input: unknown): Promise<string>;
  discard(input: unknown): Promise<KbDraft>;
  entities(): { id: string; nombre: string; alias: string[]; clase: string }[];
}

const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/;
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
/** KBOL's `basada_en` only points at sources and facts. */
const EVIDENCE_TYPES = ['fuente', 'hecho'];

/** Every record ID a record points at, without clause anchors. */
function referencesOf(record: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const field of ['afecta_a', 'basada_en', 'dependencias', 'derivada_de']) {
    const v = record[field];
    if (Array.isArray(v)) out.push(...v.filter((x): x is string => typeof x === 'string'));
  }
  for (const s of (record.sources as { resource?: string; representacion_id?: string }[] | undefined) ?? []) {
    if (s.resource) out.push(s.resource);
    if (s.representacion_id) out.push(s.representacion_id);
  }
  if (typeof record.responsable === 'string') out.push(record.responsable);
  return [...new Set(out.map(r => r.split('#')[0]!))];
}

export function createKbService(store: StudyStore, repo: KbRepo, documents: DocumentService, now: () => string): KbService {
  let lock: Promise<unknown> = Promise.resolve();
  /** Repository writes and draft creation run one at a time: git and KBOL validation are not concurrent-safe, and two
   * captures in parallel would each miss the entities and sources the other is creating. */
  const serial = <T>(fn: () => T | Promise<T>): Promise<T> => { const next = lock.then(fn, fn); lock = next.catch(() => {}); return next; };

  const pendingDrafts = () => store.listDrafts().filter(d => d.status === 'pendiente');

  /** Records as plain headers: the committed ones and those still waiting in a draft. */
  function allHeaders(): { header: Record<string, unknown>; pending: KbDraft | null }[] {
    return [
      ...repo.list().map(r => ({ header: r.header, pending: null })),
      ...pendingDrafts().flatMap(d => d.records.map(x => ({ header: x.record as unknown as Record<string, unknown>, pending: d }))),
    ];
  }

  /** The two source records of a paper, reused when they exist (committed or pending) and built otherwise. */
  function sourcesFor(doc: StudyDocument, extra: { origen: string; acceso: string }): RegisteredSources & { created: Built<KbRecord>[] } {
    const fuentes = allHeaders().map(x => x.header).filter(h => h.type === 'fuente');
    const created: Built<KbRecord>[] = [];
    let original = fuentes.find(h => h.subtipo === 'original' && h.sha256 === doc.original!.sha256)?.id as string | undefined;
    if (!original) {
      const built = fuenteOriginal(doc, extra);
      created.push(built);
      original = built.record.id;
    }
    // A paper incorporated again with a different structure gets a new derived source: citations resolve against what was verified.
    let derivada = fuentes.find(h => h.subtipo === 'derivada' && h.sha256 === doc.estructuraSha256 && Array.isArray(h.derivada_de) && (h.derivada_de as string[]).includes(original!))?.id as string | undefined;
    if (!derivada) {
      const built = fuenteDerivada(doc, original, extra.acceso);
      created.push(built);
      derivada = built.record.id;
    }
    return { original, derivada, created };
  }

  const defaults = (doc: StudyDocument) => ({ origen: `Incorporado por ${nombreEstudiante()} el ${now().slice(0, 10)} desde ${doc.path}`, acceso: 'Copia personal para estudio' });

  function knownEntities(): { id: string; nombre: string; alias: string[]; clase: string }[] {
    return allHeaders().map(x => x.header).filter(h => h.type === 'entidad').map(h => ({
      id: h.id as string, nombre: h.nombre as string, alias: (h.alias as string[]) ?? [], clase: h.clase_entidad as string,
    }));
  }

  /** Existing entities are reused by id, name or alias (accents and case ignored); only genuinely new ones are created.
   * A name that exists with another class is refused rather than silently merged. */
  function resolveEntities(value: unknown): { ids: string[]; created: Built<KbRecord>[] } {
    if (value === undefined) return { ids: [], created: [] };
    if (!Array.isArray(value) || value.length > 20) throw new StudyError('INVALID_INPUT', 'entidades must be a list of at most 20 items');
    const known = knownEntities();
    const ids: string[] = [], created: Built<KbRecord>[] = [];
    for (const [i, item] of value.entries()) {
      const r = typeof item === 'string' ? { id: item } : fields(item, ['id', 'nombre', 'clase_entidad', 'alias'], `entidades[${i}]`);
      if (r.id !== undefined) {
        const existing = text(r.id, 200, `entidades[${i}].id`, { required: true });
        if (!known.some(e => e.id === existing)) throw new StudyError('NOT_FOUND', `La entidad ${existing} no existe`);
        ids.push(existing);
        continue;
      }
      const nombre = text(r.nombre, 300, `entidades[${i}].nombre`, { required: true });
      const alias = r.alias === undefined ? [] : (Array.isArray(r.alias) ? r.alias : [r.alias]).map((a, j) => text(a, 300, `entidades[${i}].alias[${j}]`));
      if (r.clase_entidad !== undefined && !ENTITY_CLASSES.includes(r.clase_entidad as EntityClass)) throw new StudyError('INVALID_INPUT', `clase_entidad debe ser una de: ${ENTITY_CLASSES.join(', ')}`);
      const clase = r.clase_entidad as EntityClass | undefined;
      const names = [nombre, ...alias].map(fold);
      const candidates = [...known, ...created.map(c => ({ id: c.record.id, nombre: (c.record as { nombre: string }).nombre, alias: (c.record as { alias: string[] }).alias, clase: (c.record as { clase_entidad: string }).clase_entidad }))];
      const match = candidates.find(e => [e.nombre, ...e.alias].map(fold).some(n => names.includes(n)));
      if (match) {
        if (clase && match.clase !== clase) throw new StudyError('INVALID_INPUT', `«${nombre}» ya existe como ${match.clase} (${match.id}): usa ese ID o un nombre distinto`);
        ids.push(match.id);
        continue;
      }
      const built = entidad({ nombre, clase_entidad: clase ?? 'concepto', alias });
      created.push(built);
      ids.push(built.record.id);
    }
    return { ids: [...new Set(ids)], created };
  }

  function knownIds(list: unknown, path: string, types?: string[]): string[] {
    if (list === undefined) return [];
    if (!Array.isArray(list)) throw new StudyError('INVALID_INPUT', `${path} must be a list`);
    const typeOf = new Map(allHeaders().map(x => [x.header.id as string, x.header.type as string]));
    return list.map((x, i) => {
      const v = text(x, 200, `${path}[${i}]`, { required: true });
      const type = typeOf.get(v);
      if (!type) throw new StudyError('NOT_FOUND', `${v} no existe en la base`);
      if (types && !types.includes(type)) throw new StudyError('INVALID_INPUT', `${path} solo admite ${types.join(' o ')}; ${v} es ${type}`);
      return v;
    });
  }

  function saveDraft(kind: KbDraft['kind'], summary: string, origin: KbDraft['origin'], records: Built<KbRecord>[]): KbDraft {
    return store.saveDraft({ id: randomUUID(), revision: 1, kind, summary: summary.slice(0, 1000), origin, records, status: 'pendiente', createdAt: now(), commit: null }, null);
  }

  /** Every reference resolves in the repository or in this same batch; one into another pending draft says which. */
  function checkReferences(records: Built<KbRecord>[], batch: Set<string>): void {
    const committed = new Set(repo.list().map(r => r.header.id as string));
    const elsewhere = new Map(pendingDrafts().filter(d => !batch.has(d.id)).flatMap(d => d.records.map(x => [x.record.id, d] as const)));
    const inBatch = new Set(records.map(x => x.record.id));
    for (const { record } of records) {
      for (const ref of referencesOf(record as unknown as Record<string, unknown>)) {
        if (committed.has(ref) || inBatch.has(ref)) continue;
        const other = elsewhere.get(ref);
        throw new StudyError('INVALID_TRANSITION', other
          ? `${record.id} usa ${ref}, que está en el borrador pendiente «${other.summary.slice(0, 80)}»: confírmalos juntos`
          : `${record.id} usa ${ref}, que ya no existe en la base`);
      }
    }
  }

  /** A fact's quote is checked again at confirmation: the paper may have been incorporated again since the capture. */
  function reverifyQuotes(records: Built<KbRecord>[]): void {
    const local = new Map(records.map(x => [x.record.id, x.record as unknown as Record<string, unknown>]));
    for (const { record } of records) {
      if (record.type !== 'hecho') continue;
      const source = (record as KbHecho).sources[0];
      if (!source?.representacion_id || !source.ancla || !source.contexto) continue;
      const derivada = local.get(source.representacion_id) ?? repo.get(source.representacion_id)?.header;
      const page = parsePdfAnchor(source.ancla)?.p;
      const doc = store.listDocuments().find(d => d.status === 'listo' && d.original?.sha256 === source.hash && d.estructuraSha256 === derivada?.sha256);
      if (!doc || page === undefined) throw new StudyError('INVALID_TRANSITION', `La cita de «${record.title}» ya no se puede comprobar: el paper no está incorporado con la estructura citada. Vuelve a capturarla.`);
      const check = documents.verify({ documentId: doc.id, page, quote: source.contexto });
      if (check.estado !== 'resuelta') throw new StudyError('INVALID_TRANSITION', `La cita de «${record.title}» ya no se verifica: ${check.motivo}`);
    }
  }

  return {
    entities: knownEntities,
    drafts: () => pendingDrafts().sort((a, b) => a.createdAt.localeCompare(b.createdAt)),

    /** David registering a paper explicitly writes its sources at once; the tutor's captures only draft them. */
    async registerDocument(input) {
      const r = fields(input, ['documentId', 'origen', 'acceso'], 'input');
      const doc = store.getDocument(id(r.documentId, 'input.documentId'));
      if (!doc || doc.status !== 'listo' || !doc.original) throw new StudyError('INVALID_TRANSITION', 'Solo se registran documentos ya incorporados');
      return serial(async () => {
        await repo.ensureInitialized();
        const d = defaults(doc);
        const sources = sourcesFor(doc, {
          origen: r.origen === undefined || r.origen === '' ? d.origen : text(r.origen, 1000, 'input.origen'),
          acceso: r.acceso === undefined || r.acceso === '' ? d.acceso : text(r.acceso, 500, 'input.acceso'),
        });
        if (sources.created.length > 0) {
          await repo.commit(sources.created.map(b => ({ path: recordPath(b.record), text: renderRecord(b.record, b.body) })), `Registra el paper «${doc.title}»`);
        }
        return { original: sources.original, derivada: sources.derivada };
      });
    },

    captureFact(input, origin) {
      const r = fields(input, ['documentId', 'page', 'quote', 'afirmacion', 'titulo', 'fecha', 'entidades'], 'input');
      const documentId = id(r.documentId, 'input.documentId');
      const quote = text(r.quote, 2000, 'input.quote', { required: true });
      const afirmacion = text(r.afirmacion, 4000, 'input.afirmacion', { required: true });
      const fecha = r.fecha === undefined || r.fecha === '' ? now().slice(0, 10) : text(r.fecha, 10, 'input.fecha');
      if (!DATE.test(fecha)) throw new StudyError('INVALID_INPUT', 'fecha debe ser AAAA, AAAA-MM o AAAA-MM-DD');
      return serial(async () => {
        const check = documents.verify({ documentId, page: r.page, quote });
        if (check.estado !== 'resuelta') throw new StudyError('INVALID_INPUT', `La cita no se verifica: ${check.motivo}`);
        const doc = store.getDocument(documentId);
        if (!doc || doc.status !== 'listo' || !doc.original) throw new StudyError('INVALID_TRANSITION', 'Solo se capturan hechos de documentos ya incorporados');
        const { ids, created } = resolveEntities(r.entidades);
        const sources = sourcesFor(doc, defaults(doc));
        const hecho = hechoFromQuote({
          original: sources.original, derivada: sources.derivada, originalSha256: doc.original.sha256, page: r.page as number, quote, afirmacion,
          titulo: r.titulo === undefined || r.titulo === '' ? afirmacion : text(r.titulo, 300, 'input.titulo'),
          // KBOL wants a full date; a year or month is that period's first day with the matching precision.
          fecha: fecha.length === 4 ? `${fecha}-01-01` : fecha.length === 7 ? `${fecha}-01` : fecha,
          precision: fecha.length === 4 ? 'anio' : fecha.length === 7 ? 'mes' : 'dia', entidades: ids, origen: origin,
        });
        return saveDraft('hecho', afirmacion, origin, [hecho, ...sources.created, ...created]);
      });
    },

    async addQuestion(input, origin) {
      const r = fields(input, ['titulo', 'texto', 'subtipo', 'condicionCierre', 'afectaA', 'basadaEn'], 'input');
      if (r.subtipo !== 'incognita' && r.subtipo !== 'discrepancia') throw new StudyError('INVALID_INPUT', 'subtipo debe ser incognita o discrepancia');
      await serial(() => repo.ensureInitialized());
      const built = pregunta({
        titulo: text(r.titulo, 300, 'input.titulo', { required: true }), texto: text(r.texto, 8000, 'input.texto', { required: true }), subtipo: r.subtipo,
        condicionCierre: text(r.condicionCierre, 1000, 'input.condicionCierre', { required: true }), responsable: repo.owner().rol,
        afectaA: knownIds(r.afectaA, 'input.afectaA'), basadaEn: knownIds(r.basadaEn, 'input.basadaEn', EVIDENCE_TYPES),
      });
      return saveDraft('pregunta', built.record.title, origin, [built]);
    },

    async addSynthesis(input, origin) {
      const r = fields(input, ['titulo', 'texto', 'dependencias'], 'input');
      const dependencias = knownIds(r.dependencias, 'input.dependencias');
      if (dependencias.length === 0) throw new StudyError('INVALID_INPUT', 'Una síntesis depende de al menos una fuente, hecho o entidad');
      const built = sintesis({ titulo: text(r.titulo, 300, 'input.titulo', { required: true }), texto: text(r.texto, 20000, 'input.texto', { required: true }), dependencias });
      return saveDraft('sintesis', built.record.title, origin, [built]);
    },

    async confirm(input) {
      const r = fields(input, ['draftIds'], 'input');
      if (!Array.isArray(r.draftIds) || r.draftIds.length === 0) throw new StudyError('INVALID_INPUT', 'draftIds must be a non-empty list');
      const ids = [...new Set(r.draftIds.map((x, i) => id(x, `input.draftIds[${i}]`)))];
      return serial(async () => {
        // Read inside the lock: a second click that queued behind the first finds the drafts already confirmed.
        const drafts = ids.map(x => {
          const draft = store.getDraft(x);
          if (!draft || draft.status !== 'pendiente') throw new StudyError('INVALID_TRANSITION', `El borrador ${x} no está pendiente`);
          return draft;
        });
        await repo.ensureInitialized();
        const records = drafts.flatMap(d => d.records);
        checkReferences(records, new Set(ids));
        reverifyQuotes(records);
        const files = records.map(x => ({ path: recordPath(x.record), text: renderRecord(x.record, x.body) }));
        const sha = await repo.commit(files, drafts.length === 1 ? drafts[0]!.summary.slice(0, 72) : `Confirma ${drafts.length} registros de estudio`);
        for (const d of drafts) { const current = store.getDraft(d.id)!; store.saveDraft({ ...current, revision: current.revision + 1, status: 'confirmado', commit: sha }, current.revision); }
        return sha;
      });
    },

    discard(input) {
      const r = fields(input, ['draftId'], 'input');
      const draftId = id(r.draftId, 'input.draftId');
      return serial(() => {
        const draft = store.getDraft(draftId);
        if (draft?.status === 'confirmado') throw new StudyError('INVALID_TRANSITION', 'El borrador ya se confirmó');
        if (!draft || draft.status !== 'pendiente') throw new StudyError('INVALID_TRANSITION', 'El borrador no está pendiente');
        // A draft whose entities or sources another pending draft reuses cannot go alone: the other would point at nothing.
        const own = new Set(draft.records.map(x => x.record.id));
        const user = pendingDrafts().find(d => d.id !== draft.id && d.records.some(x => referencesOf(x.record as unknown as Record<string, unknown>).some(ref => own.has(ref))));
        if (user) throw new StudyError('INVALID_TRANSITION', `El borrador «${user.summary.slice(0, 80)}» usa registros de este: descártalo o confírmalo antes`);
        return store.saveDraft({ ...draft, revision: draft.revision + 1, status: 'descartado' }, draft.revision);
      });
    },
  };
}
