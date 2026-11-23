import type { PluginInference, PluginLearningData, PluginToolContext } from 'learnharness-plugin-api';
import type { StoredRecord } from '../kb/repo.ts';
import type { SearchDoc } from '../kb/search.ts';
import type { Today } from '../practice/service.ts';
import type { StudyStore } from '../study/store.ts';
import { inArea, type AreaFilter } from '../study/areas.ts';
import type { StudyArea } from '../study/types.ts';
import { composeBriefing } from './briefing.ts';
import { cheapModel, summarizeTranscript } from './summary.ts';
import { toolTraffic, transcriptText } from './transcript.ts';
import { emptyConversation, origenDe, type ConversationRecord, type ConversationView, type LinkedItem, type Origen } from './types.ts';

/** A conversation is summarized once it has been quiet this long. */
export const IDLE_MS = 20 * 60 * 1000;
/** On activation, only recent conversations are caught up, and only a few: summaries cost model calls. */
export const CATCH_UP_DAYS = 30;
export const CATCH_UP_MAX = 10;
/** Shorter conversations say too little to be worth a summary. */
export const MIN_TRANSCRIPT = 400;
const PREVIOUS = 3;
/** Conversations listed and indexed: the most recent ones; older ones keep their native record. */
export const MAX_CONVERSATIONS = 200;
const RECENT_ATTEMPTS = 5;
const SEARCH_TEXT_MAX = 60000;
const NO_CHEAP_MODEL = 'Sin modelo barato configurado en Ajustes: las conversaciones no se resumen.';
const CHAT_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface SessionDeps {
  store: StudyStore;
  learning: PluginLearningData;
  inference: PluginInference;
  today: (filter: AreaFilter) => Today;
  /** The active space, or null for «Todos»: the briefing is scoped to it and the conversation keeps it. */
  area: () => StudyArea | null;
  kbRecords: () => StoredRecord[];
  now: () => string;
  signal: AbortSignal;
  onChange: () => void;
}

export interface SessionService {
  /** The frozen briefing of a conversation, composed on its first turn. */
  briefingFor(context: PluginToolContext): string;
  onTurnSettled(chatId: string): void;
  catchUp(): void;
  summarizeNow(chatId: string): Promise<ConversationView>;
  /** Records a conversation the app opened with a study context: its space, the unit it is about and its origin. */
  register(chatId: string, link: { areaId: string | null; unitId: string | null; origen: Origen }): void;
  /** Conversations of one space, or all of them when the filter is null or absent. */
  list(filter?: AreaFilter): ConversationView[];
  /** Trashes the records of conversations the app no longer has, so no unit or space keeps a link to them.
   * True if any record went. */
  forgetDeleted(): boolean;
  searchDocs(): SearchDoc[];
  dispose(): void;
}

export function createSessionService(deps: SessionDeps): SessionService {
  const { store, learning, now, signal } = deps;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const queued = new Map<string, Promise<void>>();
  /** Briefings already given in this activation, so a store failure never lets a prompt change mid-conversation. */
  const frozen = new Map<string, string>();
  let chain: Promise<unknown> = Promise.resolve();
  /** Transcripts read once per chat version: listing and indexing must not re-read every chat file each time. */
  const cache = new Map<string, { updatedAt: string; text: string; traffic: string }>();

  function readChat(chatId: string, updatedAt: string): { text: string; traffic: string } | null {
    const hit = cache.get(chatId);
    if (hit && hit.updatedAt === updatedAt) return hit;
    const record = learning.getSession(chatId);
    if (!record) return null;
    const entry = { updatedAt: record.updatedAt, text: transcriptText(record), traffic: toolTraffic(record) };
    cache.set(chatId, entry);
    return entry;
  }

  function save(chatId: string, change: (current: ConversationRecord) => Partial<ConversationRecord>): ConversationRecord {
    const current = store.getConversation(chatId);
    const base = current ?? emptyConversation(chatId);
    return store.saveConversation({ ...base, ...change(base), id: chatId, revision: base.revision + 1 }, current?.revision ?? null);
  }

  /** What a conversation can link to, read once per listing rather than once per conversation. */
  function linkables() {
    let kb: { id: string; title: string; kind: string }[] = [];
    try { kb = deps.kbRecords().filter(r => typeof r.header.id === 'string').map(r => ({ id: r.header.id as string, title: String(r.header.title ?? r.header.id), kind: String(r.header.type) })); }
    catch { /* links to the base are lost, not the listing */ }
    return { units: store.listUnits(), documents: store.listDocuments(), kb, drafts: store.listDrafts() };
  }

  /** Units, papers and knowledge records the study tools touched in a conversation, plus the units born in it. */
  function linksOf(chatId: string, unitId: string | null, traffic: string, known: ReturnType<typeof linkables>): LinkedItem[] {
    const links = new Map<string, LinkedItem>();
    const add = (item: LinkedItem) => { if (!links.has(item.id)) links.set(item.id, item); };
    for (const u of known.units) if (u.id === unitId || u.origin.chatId === chatId || traffic.includes(u.id)) add({ id: u.id, title: u.title, kind: 'unidad' });
    for (const d of known.documents) if (traffic.includes(d.id)) add({ id: d.id, title: d.title, kind: 'documento' });
    for (const r of known.kb) if (traffic.includes(r.id)) add(r);
    // A drafted claim appears in the tool result by its draft id; it links to the record the draft holds.
    for (const d of known.drafts) {
      const first = d.records[0]?.record;
      if (first && traffic.includes(d.id)) add({ id: first.id, title: first.title, kind: first.type });
    }
    return [...links.values()];
  }

  /** A chat file that cannot be read costs that conversation its text and links, not the whole listing. */
  function safeRead(chatId: string, updatedAt: string): { text: string; traffic: string } | null {
    try { return readChat(chatId, updatedAt); } catch { return null; }
  }

  function views(filter: AreaFilter = null): ConversationView[] {
    const records = new Map(store.listConversations().map(c => [c.id, c]));
    const known = linkables();
    return learning.listSessions().filter(s => s.messageCount > 0 && inArea({ areaId: records.get(s.id)?.areaId ?? null }, filter)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_CONVERSATIONS).map(s => {
      const record = records.get(s.id);
      const chat = safeRead(s.id, s.updatedAt);
      return {
        id: s.id, title: s.title, kind: s.kind, createdAt: s.createdAt, updatedAt: s.updatedAt, messageCount: s.messageCount,
        summary: record?.summary ?? null, summaryStale: !!record?.summary && record.summaryOf !== s.updatedAt,
        summaryError: record?.summaryError ?? null, links: linksOf(s.id, record?.unitId ?? null, chat?.traffic ?? '', known), areaId: record?.areaId ?? null,
        unitId: record?.unitId ?? null, origen: origenDe(record),
      };
    });
  }

  async function summarize(chatId: string, purpose: 'user' | 'background'): Promise<void> {
    if (signal.aborted) return;
    const session = learning.listSessions().find(s => s.id === chatId);
    if (!session || (session.busy && purpose === 'background')) return;
    const chat = readChat(chatId, session.updatedAt);
    if (!chat) return;
    if (chat.text.length < MIN_TRANSCRIPT) {
      if (purpose === 'user') throw new Error('La conversación es demasiado corta para resumirla.');
      return;
    }
    const model = await cheapModel(deps.inference);
    if (signal.aborted) return;
    if (!model) {
      if (store.getConversation(chatId)?.summaryError !== NO_CHEAP_MODEL) { save(chatId, () => ({ summaryError: NO_CHEAP_MODEL })); deps.onChange(); }
      if (purpose === 'user') throw new Error(NO_CHEAP_MODEL);
      return;
    }
    try {
      const summary = await summarizeTranscript(deps.inference, model, session.title, chat.text, signal);
      if (signal.aborted) return;
      save(chatId, () => ({ summary, summaryOf: session.updatedAt, summarizedAt: now(), summaryError: null }));
      deps.onChange();
    } catch (error) {
      if (signal.aborted) return;
      // A provider's error body can be long; the record keeps its beginning, the caller gets it whole.
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      save(chatId, () => ({ summaryError: message }));
      deps.onChange();
      if (purpose === 'user') throw error;
    }
  }

  /** Waits out what remains of the quiet period, so a conversation active just before activation is not forgotten. */
  function schedule(chatId: string, delay: number): void {
    clearTimeout(timers.get(chatId));
    const timer = setTimeout(() => { timers.delete(chatId); void enqueue(chatId, 'background'); }, Math.max(0, delay));
    timer.unref?.();
    timers.set(chatId, timer);
  }

  /** One summary at a time, each chat at most once in the queue. */
  function enqueue(chatId: string, purpose: 'user' | 'background'): Promise<void> {
    const pending = queued.get(chatId);
    if (pending) return pending;
    const run = chain.then(() => summarize(chatId, purpose)).finally(() => { queued.delete(chatId); });
    chain = run.catch(() => {});
    queued.set(chatId, run);
    return run;
  }

  return {
    briefingFor(context) {
      if (signal.aborted || !CHAT_ID.test(context.chatId)) return '';
      const remembered = frozen.get(context.chatId);
      if (remembered !== undefined) return remembered;
      let existing: ConversationRecord | null = null;
      try { existing = store.getConversation(context.chatId); } catch { /* unreadable record: treated as absent, frozen in memory below */ }
      if (existing?.briefedAt) { frozen.set(context.chatId, existing.briefing ?? ''); return existing.briefing ?? ''; }

      // A briefing belongs at the start. A conversation that already has tutor turns (older than this feature, or
      // whose first turn ran before the plugin was ready) is frozen without one, so its prompt never changes midway.
      let started = false;
      try { started = (learning.getSession(context.chatId)?.messages ?? []).some(m => m.role === 'assistant'); } catch { started = true; }
      if (started) {
        frozen.set(context.chatId, '');
        try { save(context.chatId, () => ({ briefing: '', briefedAt: now() })); } catch { /* the in-memory freeze holds for this activation */ }
        return '';
      }

      // Scoped to the conversation's space (the one it was opened in, else the active one): its plan, units, reviews,
      // attempts and conversations. The knowledge base is one.
      let area = deps.area();
      if (existing?.areaId) { try { area = store.getArea(existing.areaId) ?? area; } catch { /* the active space stands in */ } }
      const filter = area?.id ?? null;
      const units = store.listUnits().filter(u => inArea(u, filter));
      const titles = new Map(units.map(u => [u.id, u.title]));
      const plans = store.listPlans().filter(p => p.estado !== 'archivado' && inArea(p, filter)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const linked = new Set(store.listPlans().filter(p => p.estado !== 'archivado').flatMap(p => p.elementos.flatMap(e => (e.unitId ? [e.unitId] : []))));
      const today = deps.today(filter);
      const recent = store.listAttempts().filter(a => a.status === 'graded' && a.grades.length > 0 && titles.has(a.unitId))
        .map(a => ({ a, grade: a.grades.at(-1)! })).sort((x, y) => y.grade.gradedAt.localeCompare(x.grade.gradedAt)).slice(0, RECENT_ATTEMPTS)
        .map(({ a, grade }) => ({ title: titles.get(a.unitId) ?? a.unitId, taskKind: a.taskKind, fidelity: grade.fidelity, failureType: grade.failureType ?? a.judgments.at(-1)?.failureType ?? null, at: grade.gradedAt }));
      let questions: string[] = [];
      try { questions = deps.kbRecords().filter(r => r.header.type === 'pregunta' && r.header.estado === 'abierta').map(r => String(r.header.title)); }
      catch { /* an unreadable base must not cost the conversation its briefing */ }
      const records = new Map(store.listConversations().map(c => [c.id, c]));
      const summariesOff = [...records.values()].some(c => c.summaryError === NO_CHEAP_MODEL);
      const previous = learning.listSessions().filter(s => s.id !== context.chatId && s.messageCount > 0 && inArea({ areaId: records.get(s.id)?.areaId ?? null }, filter))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, PREVIOUS)
        .map(s => ({ date: s.updatedAt.slice(0, 10), title: s.title, summary: records.get(s.id)?.summary ?? null }));

      const briefing = composeBriefing({
        area: area ? { name: area.name, description: area.description } : null,
        plans: plans.map(p => ({ goal: p.goal, proposed: p.estado === 'propuesto', items: p.elementos.map(e => `${e.tipo}: ${e.titulo}${e.fecha ? ` (${e.fecha})` : ''}${e.hecho ? ' (done)' : ''}${e.unitId ? ' [unit]' : ''}`) })),
        withoutPlan: units.filter(u => u.status === 'activa' && !linked.has(u.id)).map(u => u.title),
        due: today.queue.map(q => ({ title: q.title, taskKind: q.nextTaskKind, lastFailure: q.lastFailure, needsVerification: q.needsVerification })),
        openAttempts: today.open.length, recent, questions,
        drafts: store.listDrafts().filter(d => d.status === 'pendiente').length,
        previous, summariesOff,
      });
      // Frozen in memory first: if the store cannot keep it, the prompt still does not change during this activation.
      frozen.set(context.chatId, briefing);
      // A conversation opened with a study context was registered with its origin; any other one starts here, free.
      // A record registered before origins existed keeps none: it is read by its unit, not rewritten.
      try { save(context.chatId, () => ({ briefing, briefedAt: now(), areaId: filter, origen: existing ? existing.origen : 'libre' })); } catch { /* kept in memory only */ }
      return briefing;
    },

    onTurnSettled(chatId) {
      if (signal.aborted || !CHAT_ID.test(chatId)) return;
      schedule(chatId, IDLE_MS);
    },

    catchUp() {
      const records = new Map(store.listConversations().map(c => [c.id, c]));
      const at = Date.parse(now());
      const oldest = at - CATCH_UP_DAYS * 86400000;
      const due = learning.listSessions()
        .filter(s => CHAT_ID.test(s.id) && s.messageCount > 0 && !s.busy && Date.parse(s.updatedAt) >= oldest && records.get(s.id)?.summaryOf !== s.updatedAt)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      let picked = 0;
      for (const s of due) {
        if (picked >= CATCH_UP_MAX) break;
        // Short conversations are never summarized, so they must not take the places of the ones that will be.
        if ((safeRead(s.id, s.updatedAt)?.text.length ?? 0) < MIN_TRANSCRIPT) continue;
        picked++;
        const left = Date.parse(s.updatedAt) + IDLE_MS - at;
        if (left > 0) schedule(s.id, left);
        else void enqueue(s.id, 'background');
      }
    },

    async summarizeNow(chatId) {
      if (!CHAT_ID.test(chatId)) throw new Error('Conversación desconocida');
      // A background summary already queued is waited for; if it left the summary current, that is the answer,
      // otherwise this request runs as David's own, so its errors reach him.
      const pending = queued.get(chatId);
      if (pending) await pending.catch(() => {});
      const session = learning.listSessions().find(s => s.id === chatId);
      if (!session || store.getConversation(chatId)?.summaryOf !== session.updatedAt) await enqueue(chatId, 'user');
      const view = views().find(v => v.id === chatId);
      if (!view) throw new Error('Conversación desconocida');
      return view;
    },

    list: views,

    register(chatId, link) {
      if (!CHAT_ID.test(chatId)) throw new Error('Conversación desconocida');
      save(chatId, () => link);
    },

    forgetDeleted() {
      if (signal.aborted) return false;
      let gone = false;
      for (const record of store.listConversations()) {
        let exists = true;
        // An unreadable chat file is not a deleted one: its record stays.
        try { exists = learning.getSession(record.id) !== null; } catch { /* kept */ }
        if (exists) continue;
        try { store.trashConversation(record.id, record.revision); } catch { continue; /* changed meanwhile: the next pass retries */ }
        clearTimeout(timers.get(record.id));
        timers.delete(record.id);
        frozen.delete(record.id);
        cache.delete(record.id);
        gone = true;
      }
      return gone;
    },

    searchDocs() {
      return views().map(v => {
        const chat = cache.get(v.id);
        const s = v.summary;
        const summary = s ? [s.tema, ...s.trabajado, ...s.claro, ...s.abierto, s.siguiente].filter(Boolean).join('\n') : '';
        return { id: `conversacion:${v.id}`, kind: 'conversacion', title: v.title, text: `${summary}\n${(chat?.text ?? '').slice(0, SEARCH_TEXT_MAX)}`, links: v.links.map(l => l.id) };
      });
    },

    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
