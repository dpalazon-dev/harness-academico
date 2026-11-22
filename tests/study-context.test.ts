/**
 * CONVERSACIONES CON CONTEXTO (HarnessAcademico, ADR 0003, ticket 03): una
 * conversación abierta desde una unidad, un pasaje o un intento nace con
 * un mensaje de contexto ANTES del primer mensaje de David, como el
 * contexto del grafo (tests/graph-context.test.ts). El contexto viaja en
 * la CREACIÓN como ids; el plugin Estudio compone el texto y registra la
 * conversación en su espacio y con su unidad.
 *
 * La ruta POST /api/chats se ejercita bajo un LH_DATA_DIR aislado. El
 * anfitrión de plugins se sustituye en su frontera (el runtime global que
 * lee getPluginHost) por uno que activa el backend real de Estudio con el
 * almacén de conversaciones del núcleo como `learning`: así se comprueba
 * de punta a punta que la conversación queda en el espacio y en la unidad.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";

// ── la frontera, ANTES de cualquier import que lea la configuración ─────────
const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-study-context-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { newStudyContextMessage, toLlmMessages } = await import("../src/core/native-messages.ts");
import type { LhMessage } from "../src/core/native-messages.ts";
const { projectView } = await import("../src/core/view.ts");
const { chatStore } = await import("../src/store/chats.ts");
const { activate } = await import("../plugins/estudio/src/backend.ts");

const handlers = new Map<string, (input: unknown) => unknown>();
const calls: { operation: string; input: unknown }[] = [];
const learning = {
	getSession: (id: string) => {
		const c = chatStore.getChat(id);
		return c ? { id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, messages: c.messages } : null;
	},
	listSessions: () => chatStore.listChats().map((c) => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt, kind: c.kind, messageCount: c.messageCount, busy: false })),
};
const stop = await activate({
	dataDirectory: path.join(TMP_DATA, "estudio"), signal: new AbortController().signal,
	handle(name: string, handler: (input: unknown) => unknown) { handlers.set(name, handler); return () => handlers.delete(name); },
	events: { emit() {}, on() { return () => {}; } },
	learning,
	registerInstructions() { return () => {}; },
	registerTools() { return () => {}; },
	inference: { async catalog() { return { slots: {} }; }, async complete() { throw new Error("sin modelo en estas pruebas"); } },
} as never);
const host = {
	async call(id: string, operation: string, input: unknown) {
		calls.push({ operation, input });
		if (id !== "estudio" || !handlers.has(operation)) throw Object.assign(new Error(`Unknown plugin operation: ${operation}`), { name: "PluginHostError", status: 404 });
		return handlers.get(operation)!(input);
	},
};
(globalThis as { __lhPlugins?: unknown }).__lhPlugins = { host, ready: Promise.resolve() };

const { POST } = await import("../app/api/chats/route.ts");
const { initialPromptOwed } = await import("../components/chat.tsx");
const { StudyContextCard } = await import("../components/estudio/contexto-card.tsx");
const React = await import("react");
const { renderToStaticMarkup } = await import("react-dom/server");

after(async () => {
	await stop();
	delete (globalThis as { __lhPlugins?: unknown }).__lhPlugins;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const estudio = async <T>(operation: string, input?: unknown) => (await handlers.get(operation)!(input)) as T;
const crear = (body: unknown) => POST(new Request("http://test/api/chats", {
	method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}));
const marcador = (id: string) => {
	const record = chatStore.getChat(id)!;
	assert.equal(record.messages.length, 1, "el contexto es message[0], solo hasta el primer turno");
	return record.messages[0] as unknown as { role: string; customType: string; content: string; details: { tipo: string; titulo: string; unidadId: string | null } };
};

let espacio: { id: string };
let unidad: { id: string };
before(async () => {
	espacio = await estudio("crear-espacio", { name: "Teoría de grafos" });
	unidad = await estudio("crear-unidad", { title: "Caminos mínimos", capability: "Calcular caminos mínimos con Dijkstra", criterion: "Sin mirar" });
	const { answerHash } = await import("../plugins/estudio/src/practice/schema.ts");
	const store = (await import("../plugins/estudio/src/study/store.ts")).openStudyStore(path.join(TMP_DATA, "estudio", "study"));
	store.saveDocument({
		id: "doc-1", revision: 1, title: "Introduction to Algorithms", path: "C:/clrs.pdf", status: "listo", error: null,
		startedAt: "2026-11-01T10:00:00.000Z", finishedAt: "2026-11-01T10:01:00.000Z", original: { sha256: "a".repeat(64), bytes: 10 },
		doclingSha256: null, estructuraSha256: "b".repeat(64), paginas: 1000, contraste: null, revisar: [], areaId: espacio.id,
	}, null);
	store.saveTask({ id: "t1", revision: 1, unitId: unidad.id, kind: "libre", prompt: "Explica Dijkstra", cues: ["1", "2", "3", "4", "5"], reference: "Relaja en orden de distancia", rubric: ["Orden"], createdAt: "2026-11-10T10:00:00.000Z", model: { provider: "p", id: "m" } }, null);
	store.saveAttempt({
		id: "a1", revision: 1, unitId: unidad.id, taskId: "t1", taskKind: "libre", openedAt: "2026-11-10T10:00:00.000Z", confidence: 70,
		cueLevel: 0, cueLevelAtFreeze: 0, answer: "Explora todos los vecinos", answerHash: answerHash("Explora todos los vecinos"), frozenAt: "2026-11-10T10:05:00.000Z", status: "frozen", contextLabel: "libre",
		judgments: [{ fidelity: 1, failureType: "estructural", rationale: "Falta la cola de prioridad.", judgedAt: "2026-11-10T10:06:00.000Z", model: { provider: "p", id: "m" } }], grades: [],
	}, null);
});

// ── el marcador puro ────────────────────────────────────────────────────────

describe("newStudyContextMessage", () => {
	const m = newStudyContextMessage("[Study context] — unidad", { tipo: "unidad", titulo: "Caminos mínimos", lineas: ["Capacidad: x"], unidadId: "u1" });

	it("lleva el texto del plugin para el modelo y los detalles para la tarjeta", () => {
		assert.equal(m.customType, "study-context");
		assert.equal(m.content, "[Study context] — unidad");
		assert.deepEqual(m.details, { tipo: "unidad", titulo: "Caminos mínimos", lineas: ["Capacidad: x"], unidadId: "u1" });
	});

	it("toLlmMessages lo aplana a un mensaje de usuario", () => {
		const wire = toLlmMessages([m as unknown as LhMessage] as never);
		assert.equal(wire.length, 1);
		assert.equal(wire[0]!.role, "user");
		assert.ok(String((wire[0]!.content as { text?: string }[])[0]!.text).includes("[Study context]"));
	});

	it("projectView: una parte de datos del lado del usuario, nunca una burbuja de texto", () => {
		const view = projectView([m as unknown as LhMessage] as never);
		assert.equal(view.length, 1);
		assert.equal(view[0]!.role, "user");
		const part = view[0]!.parts[0] as { type: string; data: unknown };
		assert.equal(part.type, "data-study-context");
		assert.deepEqual(part.data, m.details);
	});

	it("la tarjeta del chat dice qué contexto lleva, plegada", () => {
		const html = renderToStaticMarkup(React.createElement(StudyContextCard, { data: m.details as never }));
		assert.match(html, /Contexto · Unidad/);
		assert.match(html, /Caminos mínimos/);
		assert.match(html, /aria-expanded="false"/);
		assert.doesNotMatch(html, /Capacidad: x/, "las líneas solo al desplegar");
	});

	it("un registro con solo el contexto aún debe el primer mensaje", () => {
		assert.equal(initialPromptOwed([m as never], "¿por dónde empiezo?"), true);
	});
});

// ── la ruta (el contexto viaja en la creación) ──────────────────────────────

describe("POST /api/chats: studyContext se convierte en message[0]", () => {
	it("unidad: capacidad, criterio y etapa; la conversación queda en el espacio y en la página de la unidad", async () => {
		const res = await crear({ title: "Caminos mínimos", studyContext: { tipo: "unidad", unitId: unidad.id } });
		assert.equal(res.status, 200);
		const { id } = (await res.json()) as { id: string };
		const m = marcador(id);
		assert.equal(m.role, "custom");
		assert.equal(m.customType, "study-context");
		assert.match(m.content, /from the unit «Caminos mínimos»[\s\S]*What he wants to be able to do: Calcular caminos mínimos con Dijkstra[\s\S]*How he will know he can: Sin mirar[\s\S]*Stage: /);
		assert.deepEqual([m.details.tipo, m.details.unidadId], ["unidad", unidad.id]);
		// El plugin recibe el id de la conversación nueva.
		assert.deepEqual(calls.at(-1), { operation: "contexto-conversacion", input: { tipo: "unidad", unitId: unidad.id, chatId: id } });

		const lista = await estudio<{ id: string; areaId: string | null; links: { id: string }[] }[]>("conversaciones");
		const enLista = lista.find((c) => c.id === id);
		assert.equal(enLista?.areaId, espacio.id);
		assert.ok(enLista?.links.some((l) => l.id === unidad.id));
		const lectura = await estudio<{ conversaciones: { id: string }[] }>("unidad", { id: unidad.id });
		assert.ok(lectura.conversaciones.some((c) => c.id === id));
	});

	it("pasaje: documento, página y cita, vinculada a la unidad desde la que se lee", async () => {
		const res = await crear({ title: "CLRS, p. 658", studyContext: { tipo: "pasaje", documentId: "doc-1", page: 658, quote: "Dijkstra's algorithm maintains a set S", unitId: unidad.id } });
		const { id } = (await res.json()) as { id: string };
		const m = marcador(id);
		assert.equal(m.customType, "study-context");
		assert.match(m.content, /passage of «Introduction to Algorithms», page 658:\n> Dijkstra's algorithm maintains a set S/);
		assert.equal(m.details.unidadId, unidad.id);
		const lectura = await estudio<{ conversaciones: { id: string }[] }>("unidad", { id: unidad.id });
		assert.ok(lectura.conversaciones.some((c) => c.id === id));
	});

	it("intento: respuesta congelada y contraste, vinculada a su unidad", async () => {
		const res = await crear({ title: "Discutir intento", studyContext: { tipo: "intento", attemptId: "a1" } });
		const { id } = (await res.json()) as { id: string };
		const m = marcador(id);
		assert.match(m.content, /His answer, frozen before he saw the contrast:\n> Explora todos los vecinos\nReference:\n> Relaja en orden de distancia/);
		assert.match(m.content, /Model's contrast: fidelity 1\/3, failure estructural\. Falta la cola de prioridad\./);
		assert.equal(m.details.unidadId, unidad.id);
		const lectura = await estudio<{ conversaciones: { id: string }[] }>("unidad", { id: unidad.id });
		assert.ok(lectura.conversaciones.some((c) => c.id === id));
	});

	it("un contexto que el plugin rechaza no deja conversación huérfana", async () => {
		const antes = chatStore.listChats().length;
		const res = await crear({ title: "t", studyContext: { tipo: "unidad", unitId: "no-existe" } });
		assert.equal(res.status, 400);
		assert.match(((await res.json()) as { error: string }).error, /no existe/);
		assert.equal(chatStore.listChats().length, antes);
	});

	it("un studyContext malformado se rechaza antes de crear nada", async () => {
		const antes = chatStore.listChats().length;
		for (const studyContext of ["unidad", ["unidad"], null]) {
			const res = await crear({ title: "t", studyContext });
			assert.equal(res.status, 400);
		}
		assert.equal(chatStore.listChats().length, antes);
	});

	it("sin contexto, un registro vacío como siempre", async () => {
		const res = await crear({ title: "t" });
		const { id } = (await res.json()) as { id: string };
		assert.equal(chatStore.getChat(id)!.messages.length, 0);
	});
});
