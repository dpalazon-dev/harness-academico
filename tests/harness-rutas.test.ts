/**
 * Harness conversacional (diseño aprobado por David el 23-nov-2026): fijar,
 * archivar y bifurcar por las rutas del núcleo, bajo un LH_DATA_DIR aislado y
 * con el backend real de Estudio tras el anfitrión de plugins (mismo montaje
 * que tests/study-context.test.ts).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { after, before, describe, it } from "node:test";

const TMP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-harness-rutas-"));
process.env.LH_DATA_DIR = TMP_DATA;

const { chatStore } = await import("../src/store/chats.ts");
const { activate } = await import("../plugins/estudio/src/backend.ts");
import type { LhMessage } from "../src/core/native-messages.ts";

const handlers = new Map<string, (input: unknown) => unknown>();
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
(globalThis as { __lhPlugins?: unknown }).__lhPlugins = {
	host: {
		async call(id: string, operation: string, input: unknown) {
			if (id !== "estudio" || !handlers.has(operation)) throw Object.assign(new Error(`Unknown plugin operation: ${operation}`), { name: "PluginHostError", status: 404 });
			return handlers.get(operation)!(input);
		},
	},
	ready: Promise.resolve(),
};

const crearRuta = await import("../app/api/chats/route.ts");
const registroRuta = await import("../app/api/chats/[id]/route.ts");
const bifurcarRuta = await import("../app/api/chats/[id]/fork/route.ts");

after(async () => {
	await stop();
	delete (globalThis as { __lhPlugins?: unknown }).__lhPlugins;
	fs.rmSync(TMP_DATA, { recursive: true, force: true });
});

const estudio = async <T>(operation: string, input?: unknown) => (await handlers.get(operation)!(input)) as T;
const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const msg = (id: string, role: string) => ({ id, role, content: role === "assistant" ? [{ type: "text", text: id }] : id, timestamp: 0 }) as unknown as LhMessage;

let unidad: { id: string };
let espacio: { id: string };
let original: string;
before(async () => {
	espacio = await estudio("crear-espacio", { name: "Cálculo" });
	unidad = await estudio("crear-unidad", { title: "Regla de la cadena", capability: "Derivar funciones compuestas", criterion: "Sin mirar" });
	const res = await crearRuta.POST(new Request("http://test/api/chats", json({ title: "Regla de la cadena", studyContext: { tipo: "unidad", unitId: unidad.id } })));
	original = ((await res.json()) as { id: string }).id;
	const ctx = chatStore.getChat(original)!.messages;
	chatStore.saveMessages(original, [...ctx, msg("u1", "user"), msg("a1", "assistant"), msg("u2", "user"), msg("a2", "assistant")]);
});

describe("harness — fijar y archivar", () => {
	it("marca y desmarca sin tocar updatedAt, y la lista lo devuelve", async () => {
		const antes = chatStore.getChat(original)!.updatedAt;
		const put = (body: unknown) => registroRuta.PUT(new Request("http://test", { ...json(body), method: "PUT" }), params(original));
		assert.deepEqual(await (await put({ pinned: true })).json(), { pinned: true, archived: false });
		assert.deepEqual(await (await put({ archived: true })).json(), { pinned: true, archived: true });
		const fila = (await (await crearRuta.GET()).json() as { chats: { id: string; pinned?: boolean; archived?: boolean }[] }).chats.find(c => c.id === original)!;
		assert.equal(fila.pinned, true);
		assert.equal(fila.archived, true);
		await put({ pinned: false, archived: false });
		const record = chatStore.getChat(original)!;
		assert.equal("pinned" in record, false);
		assert.equal("archived" in record, false);
		assert.equal(record.updatedAt, antes);
	});
	it("rechaza valores que no son booleanos y sigue renombrando como antes", async () => {
		const put = (body: unknown) => registroRuta.PUT(new Request("http://test", { ...json(body), method: "PUT" }), params(original));
		assert.equal((await put({ pinned: "sí" })).status, 400);
		assert.deepEqual(await (await put({ title: "Regla de la cadena" })).json(), { title: "Regla de la cadena" });
	});
});

describe("harness — mensajes fijados", () => {
	it("guarda la lista sin duplicados, sin tocar updatedAt, y la vacía borra el campo", async () => {
		const antes = chatStore.getChat(original)!.updatedAt;
		const put = (body: unknown) => registroRuta.PUT(new Request("http://test", { ...json(body), method: "PUT" }), params(original));
		assert.deepEqual(await (await put({ pinnedMessages: ["a1", "a2", "a1"] })).json(), { pinnedMessages: ["a1", "a2"] });
		assert.deepEqual(chatStore.getChat(original)!.pinnedMessages, ["a1", "a2"]);
		assert.equal((await put({ pinnedMessages: "a1" })).status, 400);
		await put({ pinnedMessages: [] });
		assert.equal("pinnedMessages" in chatStore.getChat(original)!, false);
		assert.equal(chatStore.getChat(original)!.updatedAt, antes);
	});
});

describe("harness — bifurcar", () => {
	it("crea la rama con el historial hasta esa respuesta y hereda espacio y unidad", async () => {
		const res = await bifurcarRuta.POST(new Request("http://test", json({ messageId: "a1" })), params(original));
		assert.equal(res.status, 200);
		const { id, title } = (await res.json()) as { id: string; title: string };
		assert.equal(title, "Regla de la cadena (rama)");
		const rama = chatStore.getChat(id)!;
		assert.deepEqual(rama.messages.slice(1).map(m => m.id), ["u1", "a1"]);
		assert.deepEqual(rama.forkedFrom, { chatId: original, messageId: "a1", title: "Regla de la cadena" });
		const filas = await estudio<{ id: string; unitId: string | null; areaId: string | null }[]>("conversaciones");
		const fila = filas.find(f => f.id === id)!;
		const delOriginal = filas.find(f => f.id === original)!;
		assert.equal(fila.unitId, unidad.id);
		assert.equal(fila.areaId, delOriginal.areaId);
		assert.ok(espacio.id);
	});
	it("rechaza lo que no es una respuesta del tutor y las conversaciones que no existen", async () => {
		assert.equal((await bifurcarRuta.POST(new Request("http://test", json({ messageId: "u2" })), params(original))).status, 400);
		assert.equal((await bifurcarRuta.POST(new Request("http://test", json({})), params(original))).status, 400);
		assert.equal((await bifurcarRuta.POST(new Request("http://test", json({ messageId: "a1" })), params("chat_no_existe"))).status, 404);
	});
});
