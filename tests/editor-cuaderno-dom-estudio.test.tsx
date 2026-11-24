/**
 * El editor conectado de Cuadernos montado sobre linkedom, con un servidor de mentira detrás de `fetch`: lo que pasa cuando
 * el guardado, el margen y David escriben a la vez (las carreras de revisión del 12b), y el teclado de la página (pegado,
 * salida de las tarjetas, menú `/`).
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { EditorCuaderno } from "../components/estudio/editor-cuadernos.tsx";
import type { Cuaderno } from "../components/estudio/cuadernos.ts";

const T = "2026-11-17T10:00:00.000Z";
const NL = String.fromCharCode(10);
const espera = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

type Operacion = (input: Record<string, unknown>, s: Servidor) => unknown | Promise<unknown>;
interface Servidor { nb: Cuaderno; llamadas: { op: string; input: Record<string, unknown> }[]; ops: Record<string, Operacion>; defecto: Record<string, Operacion> }

/** Un servidor con las operaciones de Estudio que usa el editor; `ops` sustituye o añade las que cada prueba necesite. */
function servidor(nb: Cuaderno, ops: Record<string, Operacion> = {}): Servidor {
	const s: Servidor = {
		nb, llamadas: [], defecto: {},
		ops: {
			cuadernos: () => [s.nb],
			estado: () => ({ units: [] }),
			documentos: () => [],
			"estado-proactivo": () => ({ tope: 40, usadas: 0, modeloEconomico: false }),
			personajes: () => ({ predefinidos: [{ id: "profesor", nombre: "Profesor", descripcion: "Porqués", tinta: "acento", predefinido: true }], propios: [], max: { personajes: 12, nombre: 40, descripcion: 400 } }),
			"guardar-cuaderno": (i) => {
				if (i.expectedRevision !== s.nb.revision) throw new Error("El cuaderno cambió mientras tanto: vuelve a abrirlo.");
				s.nb = { ...s.nb, title: i.title as string, blocks: i.blocks as Cuaderno["blocks"], revision: s.nb.revision + 1 };
				return s.nb;
			},
		},
	};
	s.defecto = { ...s.ops };
	Object.assign(s.ops, ops);
	return s;
}

let root: Root | null = null;
let restore: (() => void) | null = null;
/** El almacenamiento del navegador de la prueba: sobrevive a desmontar y volver a montar, como el de la aplicación al recargar. */
const almacenLocal = new Map<string, string>();

async function montar(s: Servidor) {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	const w = dom.window as unknown as Record<string, unknown> & { HTMLElement: typeof HTMLElement; Element: typeof Element };
	class Observador { observe() {} disconnect() {} unobserve() {} }
	w.localStorage = { getItem: (k: string) => almacenLocal.get(k) ?? null, setItem: (k: string, v: string) => { almacenLocal.set(k, v); }, removeItem: (k: string) => { almacenLocal.delete(k); } };
	const globals: Record<string, unknown> = {
		window: dom.window, document: dom.document, HTMLElement: w.HTMLElement, Element: w.Element, Node: w.Node, SVGElement: w.SVGElement,
		IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: Observador, HTMLIFrameElement: class {},
		fetch: async (_url: string, init: { body: string }) => {
			const { operation, input } = JSON.parse(init.body) as { operation: string; input?: Record<string, unknown> };
			s.llamadas.push({ op: operation, input: input ?? {} });
			try {
				const result = await s.ops[operation]!(input ?? {}, s);
				return { ok: true, status: 200, json: async () => ({ result: JSON.parse(JSON.stringify(result ?? null)) }) };
			} catch (e) {
				return { ok: false, status: 400, json: async () => ({ error: e instanceof Error ? e.message : String(e) }) };
			}
		},
	};
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	const enfocado: { el: Element | null } = { el: null };
	Object.assign(w.HTMLElement.prototype, {
		focus(this: HTMLElement) { enfocado.el = this; }, attachEvent() {}, detachEvent() {},
		getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }, getClientRects() { return []; },
		checkVisibility() { return true; },
		setSelectionRange(this: HTMLTextAreaElement, inicio: number, fin: number) {
			Object.defineProperty(this, "selectionStart", { value: inicio, configurable: true, writable: true });
			Object.defineProperty(this, "selectionEnd", { value: fin, configurable: true, writable: true });
		},
	});
	Object.defineProperty(dom.document, "activeElement", { get: () => enfocado.el, configurable: true });
	Object.assign((dom.window as unknown as { HTMLInputElement: { prototype: object } }).HTMLInputElement.prototype, { select() {} });
	root = createRoot(dom.document.querySelector("#root")!);
	restore = () => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
	const router = { bfcacheId: "x", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push(ruta: string) { s.llamadas.push({ op: "push", input: { ruta } }); }, replace() {}, async prefetch() {} };
	await act(async () => { root!.render(<AppRouterContext.Provider value={router}><EditorCuaderno id={s.nb.id} /></AppRouterContext.Provider>); });
	await act(async () => { await espera(20); });

	const doc = dom.document;
	const evento = (tipo: string, extra: Record<string, unknown> = {}) =>
		Object.assign(new (dom.window as unknown as { Event: typeof Event }).Event(tipo, { bubbles: true, cancelable: true }), { key: "", detail: 1, button: 0, ...extra });
	const parrafos = () => [...doc.querySelectorAll<HTMLTextAreaElement>('li[data-kind="nota"] textarea[data-campo="texto"]')];
	/** Lo que se ve de cada párrafo: linkedom no pinta el `value` de los campos nuevos, pero sí su copia con el símbolo. */
	const vistos = () => [...doc.querySelectorAll('li[data-kind="nota"] [data-copia]')].map(x => (x.textContent ?? "").split(String.fromCharCode(0x200b)).join(""));
	const campo = (nombre: string) => doc.querySelector<HTMLTextAreaElement>(`textarea[data-campo="${nombre}"]`)!;
	const colocarCursor = (el: HTMLTextAreaElement, pos: number) => {
		Object.defineProperty(el, "selectionStart", { value: pos, configurable: true, writable: true });
		Object.defineProperty(el, "selectionEnd", { value: pos, configurable: true, writable: true });
	};
	/** David escribe (o pega) `valor` en un campo y deja el cursor en `pos`. */
	const escribir = async (el: HTMLTextAreaElement, valor: string, pos = valor.length) => {
		const colocar = Object.getOwnPropertyDescriptor((dom.window as unknown as { HTMLTextAreaElement: { prototype: object } }).HTMLTextAreaElement.prototype, "value")!.set!;
		// React se carga antes que el DOM de la prueba y cree que no hay evento `input`: usa el camino de IE (`focusin` y luego `keyup`).
		await act(async () => { enfocado.el = el; el.dispatchEvent(evento("focusin")); colocar.call(el, valor); colocarCursor(el, pos); el.dispatchEvent(evento("keyup")); });
	};
	/** linkedom no vuelca el valor de React en los campos nuevos: se lo ponemos para que el cursor tenga un final. */
	const fijar = (el: HTMLTextAreaElement, valor: string) => Object.getOwnPropertyDescriptor((dom.window as unknown as { HTMLTextAreaElement: { prototype: object } }).HTMLTextAreaElement.prototype, "value")!.set!.call(el, valor);
	const tecla = async (el: HTMLTextAreaElement, key: string, extra: Record<string, unknown> = {}, cursor?: number) => {
		const e = evento("keydown", { key, ...extra });
		await act(async () => {
			enfocado.el = el;
			el.dispatchEvent(evento("focusin"));
			if (cursor !== undefined) colocarCursor(el, cursor);
			el.dispatchEvent(e);
		});
		return e;
	};
	const estadoGuardado = () => doc.querySelector('[role="status"][data-estado]')?.getAttribute("data-estado");
	return { dom, doc, evento, parrafos, vistos, campo, fijar, escribir, tecla, estadoGuardado, enfocado, esperar: (ms: number) => act(async () => { await espera(ms); }) };
}

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	restore?.();
	restore = null;
});

const CUADERNO: Cuaderno = { id: "nb1", revision: 1, title: "Dijkstra", kind: "libre", unitId: null, documentId: null, areaId: null, createdAt: T, updatedAt: T, blocks: [] };
const CON_NOTA: Cuaderno = { ...CUADERNO, blocks: [{ id: "n1", kind: "nota", symbol: null, text: "uno", locator: "", quote: "" }] };
const guardados = (s: Servidor) => s.llamadas.filter(l => l.op === "guardar-cuaderno");
const textos = (s: Servidor) => s.nb.blocks.map(b => (b.kind === "nota" ? `${b.symbol ?? ""}|${b.text}` : b.kind));

describe("el guardado del editor", () => {
	it("guarda lo escrito poco después y deja el indicador en «Guardado»", async () => {
		const s = servidor(CUADERNO);
		const p = await montar(s);
		await p.escribir(p.parrafos()[0]!, "hola");
		await p.esperar(900);
		assert.deepEqual(textos(s), ["|hola"]);
		assert.equal(guardados(s).length, 1);
		assert.equal(p.estadoGuardado(), "guardado");
	});
});

/** Un comentario del tutor ya guardado, como lo escribe el plugin. */
const COMENTARIO = {
	id: "c1", anchor: { blockId: "n1", text: "uno", start: 0, end: 3, prefix: "", suffix: "" }, persona: "profesor", firma: "Profesor",
	kind: "pregunta", state: "abierto", createdAt: T, thread: [{ id: "m1", role: "tutor", text: "¿Por qué uno?", at: T }],
};
const puerta = () => { let soltar!: () => void; const espera = new Promise<void>(r => { soltar = r; }); return { espera, soltar }; };

describe("carreras de revisión del editor (12b)", () => {
	it("un segundo guardado espera al primero y parte de la revisión que este devolvió", async () => {
		const g = puerta();
		let n = 0;
		const s = servidor(CUADERNO, { "guardar-cuaderno": async (i, srv) => { if (++n === 1) await g.espera; return srv.defecto["guardar-cuaderno"]!(i, srv); } });
		const p = await montar(s);
		await p.escribir(p.parrafos()[0]!, "uno");
		await p.esperar(800);
		await p.escribir(p.parrafos()[0]!, "uno dos");
		await p.esperar(800);
		assert.equal(guardados(s).length, 1, "el segundo guardado no sale mientras el primero sigue en vuelo");
		assert.equal(p.estadoGuardado(), "sin-guardar");
		g.soltar();
		await p.esperar(100);
		assert.deepEqual(guardados(s).map(l => l.input.expectedRevision), [1, 2]);
		assert.deepEqual(textos(s), ["|uno dos"]);
		assert.equal(p.estadoGuardado(), "guardado");
	});

	it("si un comentario sube la revisión a mitad de un guardado y la página es la misma, se adopta la revisión y el guardado se repite", async () => {
		let n = 0;
		const s = servidor(CUADERNO, { "guardar-cuaderno": (i, srv) => {
			// El margen se escribe en el servidor justo antes de que llegue el guardado.
			if (++n === 1) srv.nb = { ...srv.nb, revision: 2, comments: [COMENTARIO] } as Cuaderno;
			return srv.defecto["guardar-cuaderno"]!(i, srv);
		} });
		const p = await montar(s);
		await p.escribir(p.parrafos()[0]!, "hola");
		await p.esperar(900);
		assert.deepEqual(guardados(s).map(l => l.input.expectedRevision), [1, 2], "el primero chocó y el repetido lleva la revisión del margen");
		assert.deepEqual(textos(s), ["|hola"]);
		assert.equal(p.estadoGuardado(), "guardado");
		assert.ok(p.doc.querySelector('[data-margen-id="c1"]'), "el comentario que llegó por el camino se ve en el margen");
		assert.equal(s.nb.comments?.length, 1, "y el guardado de la página no lo pisó");
	});

	it("si la página cambió de verdad en el servidor, no se repite: el conflicto se enseña", async () => {
		const s = servidor(CUADERNO, { "guardar-cuaderno": (_i, srv) => {
			srv.nb = { ...srv.nb, revision: 5, blocks: [{ id: "ajeno", kind: "nota", symbol: null, text: "de otro sitio", locator: "", quote: "" }] };
			throw new Error("El cuaderno cambió mientras tanto: vuelve a abrirlo.");
		} });
		const p = await montar(s);
		await p.escribir(p.parrafos()[0]!, "hola");
		await p.esperar(900);
		assert.equal(guardados(s).length, 1, "no reintenta sobre una página distinta");
		assert.equal(p.estadoGuardado(), "error");
	});

	/** Selecciona «uno» en el primer párrafo y pulsa «Pregúntame»; la llamada espera en la puerta del servidor. */
	// React recuerda la última selección entre pruebas y no avisa de una igual: se alterna para que cada prueba sea una selección nueva.
	let vez = 0;
	async function preguntar(p: Awaited<ReturnType<typeof montar>>) {
		const area = p.parrafos()[0]!;
		p.fijar(area, "uno");
		await act(async () => {
			p.enfocado.el = area;
			area.dispatchEvent(p.evento("focusin"));
			Object.defineProperty(area, "selectionStart", { value: 0, configurable: true, writable: true });
			Object.defineProperty(area, "selectionEnd", { value: (vez++ % 2 === 0) ? 3 : 2, configurable: true, writable: true });
			area.dispatchEvent(p.evento("keyup"));
		});
		const boton = p.doc.querySelector('[data-pedir="pregunta"]');
		assert.ok(boton, "con texto seleccionado aparece la barra");
		// El `mouseup` es para React: si no, recuerda el ratón pulsado en las pruebas siguientes y no avisa de selecciones.
		await act(async () => { boton.dispatchEvent(p.evento("mousedown")); boton.dispatchEvent(p.evento("mouseup")); });
	}
	const respuesta = (srv: Servidor) => { srv.nb = { ...srv.nb, revision: srv.nb.revision + 1, comments: [COMENTARIO] } as Cuaderno; return srv.nb; };

	it("la respuesta del tutor que llega con la página ya editada trae el comentario sin tocar lo que David escribió", async () => {
		const g = puerta();
		const s = servidor(CON_NOTA, { "comentar-cuaderno": async (_i, srv) => { await g.espera; return respuesta(srv); } });
		const p = await montar(s);
		await preguntar(p);
		assert.ok(p.doc.querySelector('[data-estado="pensando"]'), "mientras tanto la tarjeta dice que piensa");
		await p.escribir(p.parrafos()[0]!, "uno dos");
		g.soltar();
		await p.esperar(50);
		assert.equal(p.parrafos()[0]!.value, "uno dos", "la respuesta no deshace lo que David acaba de escribir");
		assert.ok(p.doc.querySelector('[data-margen-id="c1"]'), "el comentario llega al margen");
		assert.equal(p.doc.querySelector('[data-estado="pensando"]'), null);
		await p.esperar(900);
		assert.equal(guardados(s).at(-1)!.input.expectedRevision, s.nb.revision - 1, "el último guardado parte de la revisión que ya incluía el comentario, sin chocar");
		assert.deepEqual(textos(s), ["|uno dos"]);
		assert.equal(s.nb.comments?.length, 1);
		assert.equal(p.estadoGuardado(), "guardado");
	});

	it("la respuesta que llega después de un guardado y trae una revisión más vieja no pisa la que ya se conoce", async () => {
		const g = puerta();
		const s = servidor(CON_NOTA, { "comentar-cuaderno": async (_i, srv) => { await g.espera; return { ...srv.nb, revision: 1, comments: [COMENTARIO] }; } });
		const p = await montar(s);
		await preguntar(p);
		await p.escribir(p.parrafos()[0]!, "uno dos");
		await p.esperar(900);
		assert.ok(s.nb.revision >= 2, "la página ya se guardó");
		g.soltar();
		await p.esperar(50);
		assert.equal(p.doc.querySelector('[data-margen-id="c1"]'), null, "una respuesta más vieja que la revisión conocida se ignora");
		assert.equal(p.parrafos()[0]!.value, "uno dos");
	});

	it("si el tutor falla, la página sigue usable y la tarjeta dice por qué", async () => {
		const s = servidor(CON_NOTA, { "comentar-cuaderno": () => { throw new Error("Sin modelo fuerte"); } });
		const p = await montar(s);
		await preguntar(p);
		await p.esperar(30);
		assert.match(p.doc.querySelector('[data-estado="error"]')?.textContent ?? "", /No se pudo comentar: Sin modelo fuerte/);
		await p.escribir(p.parrafos()[0]!, "uno dos");
		await p.esperar(900);
		assert.deepEqual(textos(s), ["|uno dos"]);
	});
});

describe("el teclado de la página", () => {
	it("un texto pegado con saltos de línea queda en varios párrafos y el cursor en el último", async () => {
		const s = servidor(CUADERNO);
		const p = await montar(s);
		await p.escribir(p.parrafos()[0]!, ["→ uno", "? dos", "tres"].join(NL));
		assert.deepEqual(p.vistos(), ["→ uno", "? dos", "tres"]);
		assert.ok(p.enfocado.el === p.parrafos()[2]);
		await p.esperar(900);
		assert.deepEqual(textos(s), ["→|uno", "?|dos", "|tres"]);
	});

	const CON_ERROR: Cuaderno = { ...CUADERNO, blocks: [
		{ id: "n1", kind: "nota", symbol: null, text: "uno", locator: "", quote: "" },
		{ id: "e1", kind: "error", wrong: "creía", cause: "", fix: "corrijo" },
	] };

	it("las flechas salen de una tarjeta de error: arriba al párrafo anterior, abajo al hueco que sigue", async () => {
		const p = await montar(servidor(CON_ERROR));
		const e = await p.tecla(p.campo("wrong"), "ArrowUp", {}, 0);
		assert.equal(e.defaultPrevented, true);
		assert.ok(p.enfocado.el === p.parrafos()[0]);
		p.fijar(p.campo("wrong"), "creía");
		await p.tecla(p.campo("wrong"), "ArrowDown", {}, "creía".length);
		assert.ok(p.enfocado.el === p.campo("cause"), "dentro de la tarjeta, al campo siguiente");
		p.fijar(p.campo("fix"), "corrijo");
		await p.tecla(p.campo("fix"), "ArrowDown", {}, "corrijo".length);
		assert.ok(p.enfocado.el === p.parrafos()[1], "desde el último campo, al hueco de debajo");
	});

	it("una flecha con el cursor en mitad del texto no sale de la tarjeta", async () => {
		const p = await montar(servidor(CON_ERROR));
		const e = await p.tecla(p.campo("wrong"), "ArrowUp", {}, 2);
		assert.equal(e.defaultPrevented, false);
		assert.ok(p.enfocado.el !== p.parrafos()[0]);
	});

	it("Retroceso quita un bloque sin nada escrito y Ctrl+Mayús+Retroceso quita uno con texto, con el cursor en el vecino", async () => {
		const s = servidor({ ...CON_ERROR, blocks: [...CON_ERROR.blocks, { id: "q1", kind: "recuperacion", question: "", answer: "" }] });
		const p = await montar(s);
		await p.tecla(p.campo("question"), "Backspace", {}, 0);
		assert.equal(p.doc.querySelector('[data-kind="recuperacion"]'), null, "la pregunta vacía se quita");
		assert.ok(p.enfocado.el === p.campo("fix"), "y el cursor queda al final del bloque anterior");
		const e = await p.tecla(p.campo("wrong"), "Backspace", {}, 0);
		assert.equal(e.defaultPrevented, false);
		assert.ok(p.doc.querySelector('[data-kind="error"]'), "con texto, Retroceso no quita nada");
		await p.tecla(p.campo("wrong"), "Backspace", { ctrlKey: true, shiftKey: true }, 3);
		assert.equal(p.doc.querySelector('[data-kind="error"]'), null);
		assert.ok(p.enfocado.el === p.parrafos()[0]);
		await p.esperar(900);
		assert.deepEqual(textos(s), ["|uno"]);
	});

	it("Ctrl+Mayús+Retroceso quita también un párrafo con texto", async () => {
		const s = servidor({ ...CUADERNO, blocks: [
			{ id: "n1", kind: "nota", symbol: null, text: "uno", locator: "", quote: "" },
			{ id: "n2", kind: "nota", symbol: null, text: "dos", locator: "", quote: "" },
		] });
		const p = await montar(s);
		await p.tecla(p.parrafos()[1]!, "Backspace", { ctrlKey: true, shiftKey: true }, 1);
		assert.deepEqual(p.vistos(), ["uno"]);
		await p.esperar(900);
		assert.deepEqual(textos(s), ["|uno"]);
	});

	it("el menú de la barra dice a los lectores de pantalla que está abierto, qué opción está activa y a qué lista apunta; Escape lo cierra", async () => {
		const p = await montar(servidor(CUADERNO));
		const area = () => p.parrafos()[0]!;
		assert.equal(area().getAttribute("aria-expanded"), null, "sin barra no hay menú");
		await p.escribir(area(), "/");
		assert.equal(area().getAttribute("role"), "combobox");
		assert.equal(area().getAttribute("aria-expanded"), "true");
		assert.equal(area().getAttribute("aria-controls"), "menu-insertar");
		assert.equal(area().getAttribute("aria-activedescendant"), "menu-insertar-error");
		assert.ok(p.doc.getElementById("menu-insertar-error"), "la opción activa existe con ese id");
		await p.tecla(area(), "ArrowDown");
		assert.equal(area().getAttribute("aria-activedescendant"), "menu-insertar-recuperacion");
		await p.tecla(area(), "Escape");
		assert.equal(area().getAttribute("aria-expanded"), null);
		assert.equal(p.doc.getElementById("menu-insertar"), null);
	});

	it("Intro en el menú de la barra inserta el bloque elegido y el cursor entra en su primer campo", async () => {
		const p = await montar(servidor(CUADERNO));
		await p.escribir(p.parrafos()[0]!, "/");
		await p.tecla(p.parrafos()[0]!, "Enter");
		assert.ok(p.doc.querySelector('[data-kind="error"]'));
		assert.ok(p.enfocado.el === p.campo("wrong"));
	});
});

/** Una pregunta, un hecho y una conexión ofrecidos por el tutor con el comentario de «uno». */
const PROPUESTAS = [
	{ id: "p1", tipo: "recuperacion", estado: "pendiente", pregunta: "¿Por qué uno?", respuesta: "Porque es el primero." },
	{ id: "p2", tipo: "hecho", estado: "pendiente", afirmacion: "Uno es el primero.", documentId: "d1", pagina: 2, cita: "uno es el primero" },
	{ id: "p3", tipo: "conexion", estado: "pendiente", destino: { tipo: "unidad", id: "u9" }, titulo: "Conteo", motivo: "Habla de lo mismo." },
];
const CON_PROPUESTAS = { ...CON_NOTA, revision: 2, comments: [{ ...COMENTARIO, propuestas: PROPUESTAS }] } as Cuaderno;
const bloqueNuevo = { id: "q1", kind: "recuperacion", question: "¿Por qué uno?", answer: "Porque es el primero." };
/** El servidor que acepta la pregunta como lo hace el plugin: bloque tras el párrafo y propuesta aceptada. */
const aceptaPregunta = (i: Record<string, unknown>, srv: Servidor) => {
	const [n1, ...resto] = srv.nb.blocks;
	const c = srv.nb.comments![0]!;
	srv.nb = { ...srv.nb, revision: srv.nb.revision + 1, blocks: [n1!, bloqueNuevo as never, ...resto],
		comments: [{ ...c, propuestas: c.propuestas!.map(x => (x.id === i.propuestaId ? { ...x, estado: "aceptada", bloqueId: "q1" } : x)) as never }] };
	return srv.nb;
};
/** El servidor que cambia el estado de una propuesta, como el plugin. */
const decide = (estado: string, extra: Record<string, unknown> = {}) => (i: Record<string, unknown>, srv: Servidor) => {
	const c = srv.nb.comments![0]!;
	srv.nb = { ...srv.nb, revision: srv.nb.revision + 1, comments: [{ ...c, propuestas: c.propuestas!.map(x => (x.id === i.propuestaId ? { ...x, estado, ...extra } : x)) as never }] };
	return srv.nb;
};
const pulsar = (p: Awaited<ReturnType<typeof montar>>, selector: string) =>
	act(async () => { p.doc.querySelector<HTMLElement>(selector)!.dispatchEvent(p.evento("click")); });

describe("propuestas del tutor en el margen (12d)", () => {
	it("la tarjeta ofrece la pregunta, el hecho y la conexión sin tocar la página, cada una con su botón", async () => {
		const s = servidor(CON_PROPUESTAS);
		const p = await montar(s);
		const tarjeta = p.doc.querySelector('[data-margen-id="c1"]')!;
		assert.deepEqual([...tarjeta.querySelectorAll("[data-propuesta]")].map(x => x.getAttribute("data-propuesta")), ["recuperacion", "hecho", "conexion"]);
		assert.equal(tarjeta.querySelectorAll("[data-aceptar-propuesta]").length, 2, "la conexión no se acepta");
		assert.equal(tarjeta.querySelectorAll("[data-descartar-propuesta]").length, 3);
		assert.match(tarjeta.querySelector('[data-campo-propuesta="respuesta"]')!.textContent!, /Porque es el primero/);
		assert.match(tarjeta.textContent!, /Quedará en «Por decidir»/);
		assert.deepEqual(p.vistos(), ["uno"]);
		assert.equal(s.llamadas.filter(l => /propuesta/.test(l.op)).length, 0, "nada se acepta solo");
	});

	it("aceptar la pregunta mete su bloque tras el párrafo, editable, y la tarjeta lo dice", async () => {
		const s = servidor(CON_PROPUESTAS, { "aceptar-propuesta": aceptaPregunta });
		const p = await montar(s);
		await pulsar(p, '[data-propuesta="recuperacion"] [data-aceptar-propuesta]');
		await p.esperar(50);
		assert.deepEqual(s.llamadas.filter(l => l.op === "aceptar-propuesta").map(l => l.input), [{ id: "nb1", commentId: "c1", propuestaId: "p1" }]);
		assert.deepEqual([...p.doc.querySelectorAll("li[data-kind]")].map(x => x.getAttribute("data-kind")), ["nota", "recuperacion", "nota"], "tras el párrafo y antes del hueco vacío del final");
		assert.ok(p.campo("question"), "es un bloque de pregunta editable");
		assert.equal(p.doc.querySelector('[data-propuesta="recuperacion"][data-estado="aceptada"]')?.textContent, "Pregunta añadida tras el párrafo");
		assert.equal(p.doc.querySelector('[data-propuesta="recuperacion"][data-estado="pendiente"]'), null);
		assert.ok(p.doc.querySelector('[data-propuesta="hecho"]'), "las otras siguen ofrecidas");
	});

	it("lo que David escribió mientras se aceptaba no se pierde y se guarda con el bloque ya dentro", async () => {
		const g = puerta();
		const s = servidor(CON_PROPUESTAS, { "aceptar-propuesta": async (i, srv) => { await g.espera; return aceptaPregunta(i, srv); } });
		const p = await montar(s);
		await pulsar(p, '[data-propuesta="recuperacion"] [data-aceptar-propuesta]');
		await p.escribir(p.parrafos()[0]!, "uno y más");
		g.soltar();
		await p.esperar(1000);
		assert.deepEqual(textos(s), ["|uno y más", "recuperacion"]);
		assert.equal(p.estadoGuardado(), "guardado");
		assert.equal(s.nb.blocks.filter(b => b.kind === "recuperacion").length, 1, "el guardado no duplicó el bloque");
	});

	it("aceptar dos veces seguidas manda una sola petición", async () => {
		const g = puerta();
		const s = servidor(CON_PROPUESTAS, { "aceptar-propuesta": async (i, srv) => { await g.espera; return aceptaPregunta(i, srv); } });
		const p = await montar(s);
		await pulsar(p, '[data-propuesta="recuperacion"] [data-aceptar-propuesta]');
		await pulsar(p, '[data-propuesta="recuperacion"] [data-aceptar-propuesta]');
		g.soltar();
		await p.esperar(50);
		assert.equal(s.llamadas.filter(l => l.op === "aceptar-propuesta").length, 1);
	});

	it("descartar una propuesta no deja rastro en la página y la quita de la tarjeta", async () => {
		const s = servidor(CON_PROPUESTAS, { "descartar-propuesta": decide("descartada") });
		const p = await montar(s);
		await pulsar(p, '[data-propuesta="recuperacion"] [data-descartar-propuesta]');
		await p.esperar(50);
		assert.equal(p.doc.querySelector('[data-propuesta="recuperacion"]'), null);
		assert.deepEqual(p.vistos(), ["uno"]);
		assert.deepEqual(textos(s), ["|uno"]);
		assert.equal(guardados(s).length, 0);
	});

	it("si el servidor rechaza la propuesta, la tarjeta dice por qué y la deja pendiente", async () => {
		const s = servidor(CON_PROPUESTAS, { "aceptar-propuesta": () => { throw new Error("La cita no se verifica: no aparece en la página"); } });
		const p = await montar(s);
		await pulsar(p, '[data-propuesta="hecho"] [data-aceptar-propuesta]');
		await p.esperar(50);
		assert.match(p.doc.querySelector('[data-propuesta="hecho"] [role="alert"]')!.textContent!, /La cita no se verifica/);
		assert.ok(p.doc.querySelector('[data-propuesta="hecho"][data-estado="pendiente"] [data-aceptar-propuesta]'), "se puede reintentar");
	});

	it("un hecho aceptado dice dónde quedó el borrador y no toca la página", async () => {
		const s = servidor(CON_PROPUESTAS, { "aceptar-propuesta": decide("aceptada", { borradorId: "b1" }) });
		const p = await montar(s);
		await pulsar(p, '[data-propuesta="hecho"] [data-aceptar-propuesta]');
		await p.esperar(50);
		assert.match(p.doc.querySelector('[data-propuesta="hecho"][data-estado="aceptada"]')!.textContent!, /Por decidir/);
		assert.deepEqual(textos(s), ["|uno"]);
	});

	it("la conexión abre la unidad enlazada", async () => {
		const s = servidor(CON_PROPUESTAS);
		const p = await montar(s);
		assert.equal(p.doc.querySelector("[data-abrir-conexion]")!.textContent, "Conteo");
		await pulsar(p, "[data-abrir-conexion]");
		assert.deepEqual(s.llamadas.filter(l => l.op === "push").map(l => l.input.ruta), ["/unidad/u9"]);
	});

	it("la conexión a un cuaderno abre ese cuaderno", async () => {
		const nb = { ...CON_PROPUESTAS, comments: [{ ...COMENTARIO, propuestas: [{ id: "p3", tipo: "conexion", estado: "pendiente", destino: { tipo: "cuaderno", id: "n7" }, titulo: "Otro", motivo: "" }] }] } as Cuaderno;
		const s = servidor(nb);
		const p = await montar(s);
		await pulsar(p, "[data-abrir-conexion]");
		assert.deepEqual(s.llamadas.filter(l => l.op === "push").map(l => l.input.ruta), ["/cuadernos/n7"]);
	});
});

describe("propuestas en un comentario atendido (12d)", () => {
	it("volver a la nota no esconde lo que el tutor ofreció y David aún no decidió", async () => {
		const atendido = { ...CON_PROPUESTAS, comments: [{ ...COMENTARIO, state: "atendido", propuestas: PROPUESTAS }] } as Cuaderno;
		const p = await montar(servidor(atendido));
		const tarjeta = p.doc.querySelector('[data-margen-id="c1"]')!;
		assert.equal(tarjeta.getAttribute("data-estado"), "atendido");
		assert.deepEqual([...tarjeta.querySelectorAll("[data-propuesta]")].map(x => x.getAttribute("data-propuesta")), ["recuperacion", "hecho", "conexion"]);
	});
});

describe("dibujos del tutor (12h)", () => {
	const DIBUJO = { id: "d1", mermaid: "flowchart TD\n  A --> ", mensajeId: "m1" };
	const CON_DIBUJO = { ...COMENTARIO, kind: "dibujo", dibujos: [DIBUJO] };
	const ESPERA_RENDER = 12000;
	/** El dibujo sale de «pintando»: en linkedom Mermaid no puede medir nada, así que lo normal es el error; vale cualquier final. */
	const esperarFinal = async (p: Awaited<ReturnType<typeof montar>>) => {
		for (let t = 0; t < ESPERA_RENDER; t += 200) {
			if (p.doc.querySelector('[data-dibujo="d1"]')?.getAttribute("data-estado") !== "pintando") return;
			await p.esperar(200);
		}
	};

	it("«Dibújalo» pide al servidor un comentario de tipo dibujo sobre la selección y el dibujo llega bajo el párrafo", async () => {
		const s = servidor(CON_NOTA, { "comentar-cuaderno": (_i, srv) => { srv.nb = { ...srv.nb, revision: srv.nb.revision + 1, comments: [CON_DIBUJO] } as Cuaderno; return srv.nb; } });
		const p = await montar(s);
		const area = p.parrafos()[0]!;
		p.fijar(area, "uno");
		await act(async () => {
			p.enfocado.el = area;
			area.dispatchEvent(p.evento("focusin"));
			Object.defineProperty(area, "selectionStart", { value: 0, configurable: true, writable: true });
			Object.defineProperty(area, "selectionEnd", { value: 3, configurable: true, writable: true });
			area.dispatchEvent(p.evento("keyup"));
		});
		const boton = p.doc.querySelector('[data-pedir="dibujo"]');
		assert.ok(boton, "la barra ofrece «Dibújalo»");
		await act(async () => { boton.dispatchEvent(p.evento("mousedown")); boton.dispatchEvent(p.evento("mouseup")); });
		await p.esperar(60);
		const llamada = s.llamadas.find(l => l.op === "comentar-cuaderno")!;
		assert.equal(llamada.input.kind, "dibujo");
		assert.equal((llamada.input.anchor as { text: string }).text, "uno");
		assert.ok(p.doc.querySelector('li[data-block-id="n1"] [data-dibujo="d1"]'), "el dibujo cuelga del párrafo");
	});

	it("un Mermaid que no se puede dibujar deja el error y su texto, y la página sigue escribiéndose", async () => {
		const s = servidor({ ...CON_NOTA, comments: [CON_DIBUJO] } as Cuaderno);
		const p = await montar(s);
		await esperarFinal(p);
		const fig = p.doc.querySelector('[data-dibujo="d1"]')!;
		assert.equal(fig.getAttribute("data-estado"), "error", "en linkedom no hay dónde medir: el dibujo acaba en error");
		assert.match(fig.querySelector("[data-dibujo-error] [role='alert']")?.textContent ?? "", /No se pudo dibujar/);
		assert.equal(fig.querySelector("[data-dibujo-codigo]")?.textContent, DIBUJO.mermaid);
		await p.escribir(p.parrafos()[0]!, "uno dos");
		await p.esperar(900);
		assert.deepEqual(textos(s), ["|uno dos"], "la página se guarda con normalidad");
		assert.equal(s.nb.comments?.[0]?.dibujos?.length, 1, "guardar la página no toca los dibujos");
	});

	it("quitar el dibujo llama al servidor y lo retira sin tocar el comentario ni la página", async () => {
		const s = servidor({ ...CON_NOTA, comments: [CON_DIBUJO] } as Cuaderno, {
			"quitar-dibujo": (i, srv) => {
				const { dibujos: _quitados, ...resto } = srv.nb.comments![0]! as unknown as Record<string, unknown>;
				srv.nb = { ...srv.nb, revision: srv.nb.revision + 1, comments: [resto] } as unknown as Cuaderno;
				return srv.nb;
			},
		});
		const p = await montar(s);
		const boton = p.doc.querySelector("[data-quitar-dibujo]")!;
		await act(async () => { boton.dispatchEvent(p.evento("click")); });
		await p.esperar(60);
		assert.deepEqual(s.llamadas.find(l => l.op === "quitar-dibujo")!.input, { id: "nb1", commentId: "c1", dibujoId: "d1" });
		assert.equal(p.doc.querySelector("[data-dibujo]"), null);
		assert.ok(p.doc.querySelector('[data-margen-id="c1"]'), "el comentario sigue en el margen");
		assert.deepEqual(textos(s), ["|uno"]);
	});
});

describe("escuchar al tutor (12j)", () => {
	class Frase { text: string; lang = ""; voice: unknown = null; onstart = null; onend: (() => void) | null = null; onerror = null; constructor(text: string) { this.text = text; } }
	let dicho: Frase[] = [];
	let cancelaciones = 0;
	beforeEach(() => {
		almacenLocal.clear(); dicho = []; cancelaciones = 0;
		Object.assign(globalThis, {
			SpeechSynthesisUtterance: Frase,
			speechSynthesis: {
				getVoices: () => [{ name: "Helena", lang: "es-ES", localService: true, default: true, voiceURI: "Helena" }],
				speak: (f: Frase) => { dicho.push(f); }, cancel: () => { cancelaciones++; }, addEventListener() {}, removeEventListener() {},
			},
		});
	});
	afterEach(() => { Reflect.deleteProperty(globalThis, "speechSynthesis"); Reflect.deleteProperty(globalThis, "SpeechSynthesisUtterance"); });

	let vez = 0;
	async function preguntar(p: Awaited<ReturnType<typeof montar>>) {
		const area = p.parrafos()[0]!;
		p.fijar(area, "uno");
		await act(async () => {
			p.enfocado.el = area;
			area.dispatchEvent(p.evento("focusin"));
			Object.defineProperty(area, "selectionStart", { value: 0, configurable: true, writable: true });
			Object.defineProperty(area, "selectionEnd", { value: (vez++ % 2 === 0) ? 3 : 2, configurable: true, writable: true });
			area.dispatchEvent(p.evento("keyup"));
		});
		const boton = p.doc.querySelector('[data-pedir="pregunta"]');
		assert.ok(boton, "con texto seleccionado aparece la barra");
		await act(async () => { boton.dispatchEvent(p.evento("mousedown")); boton.dispatchEvent(p.evento("mouseup")); });
	}
	const respuesta = (srv: Servidor) => { srv.nb = { ...srv.nb, revision: srv.nb.revision + 1, comments: [COMENTARIO] } as Cuaderno; return srv.nb; };
	// La casilla «Leer en voz alta» vive en el menú «⋯», que Radix no pinta abierto sobre linkedom: encender es lo que la casilla
	// recuerda, el interruptor guardado en el navegador para este cuaderno.
	const encender = () => { almacenLocal.set("estudio.cuaderno.escuchar.nb1", "1"); };

	it("el cuaderno nuevo abre con Escuchar apagado y sin leer nada, y la cabecera no lleva su interruptor", async () => {
		const s = servidor(CON_NOTA);
		const p = await montar(s);
		assert.equal(p.doc.querySelector("[data-escuchar-interruptor]"), null, "es una casilla del menú «⋯»");
		assert.ok(p.doc.querySelector("[data-mas-acciones]"));
		assert.equal(almacenLocal.get("estudio.cuaderno.escuchar.nb1"), undefined);
		assert.equal(dicho.length, 0);
	});

	it("encendido, la respuesta nueva del tutor se lee y escribir en la página la detiene", async () => {
		const s = servidor(CON_NOTA, { "comentar-cuaderno": (_i, srv) => respuesta(srv) });
		encender();
		const p = await montar(s);
		await preguntar(p);
		await p.esperar(50);
		assert.deepEqual(dicho.map(d => d.text), ["¿Por qué uno?"]);
		const antes = cancelaciones;
		await p.escribir(p.parrafos()[0]!, "uno dos");
		assert.ok(cancelaciones > antes, "escribir detiene la lectura");
	});

	it("apagado, la respuesta del tutor no se lee, pero su botón sí la lee", async () => {
		const s = servidor(CON_NOTA, { "comentar-cuaderno": (_i, srv) => respuesta(srv) });
		const p = await montar(s);
		await preguntar(p);
		await p.esperar(50);
		assert.equal(dicho.length, 0);
		const boton = p.doc.querySelector('[data-margen-id="c1"] [data-escuchar-mensaje="m1"]');
		assert.ok(boton, "la tarjeta del margen trae su botón");
		await act(async () => { boton.dispatchEvent(p.evento("click")); });
		await p.esperar(10);
		assert.deepEqual(dicho.map(d => d.text), ["¿Por qué uno?"]);
	});

	it("recargar un cuaderno con Escuchar encendido sigue encendido y no lee los comentarios que ya tenía", async () => {
		const nb = { ...CON_NOTA, revision: 2, comments: [COMENTARIO] } as Cuaderno;
		almacenLocal.set("estudio.cuaderno.escuchar.nb1", "1");
		const p = await montar(servidor(nb));
		await p.esperar(50);
		assert.equal(dicho.length, 0);
	});

	it("la respuesta del tutor en un hilo se lee, y escribir en el campo del hilo la detiene", async () => {
		const nb = { ...CON_NOTA, revision: 2, comments: [COMENTARIO] } as Cuaderno;
		almacenLocal.set("estudio.cuaderno.escuchar.nb1", "1");
		const s = servidor(nb, {
			"responder-comentario": (i, srv) => { srv.nb = { ...srv.nb, revision: srv.nb.revision + 1, comments: [{ ...COMENTARIO, thread: [...COMENTARIO.thread, { id: "m2", role: "david", text: i.text, at: T }] }] } as Cuaderno; return srv.nb; },
			"contestar-comentario": (_i, srv) => { srv.nb = { ...srv.nb, revision: srv.nb.revision + 1, comments: [{ ...COMENTARIO, thread: [...COMENTARIO.thread, { id: "m2", role: "david", text: "porque sí", at: T }, { id: "m3", role: "tutor", text: "Entonces, ¿qué cambia?", at: T }] }] } as Cuaderno; return srv.nb; },
		});
		const p = await montar(s);
		await act(async () => { p.doc.querySelector('[data-margen-id="c1"] [data-abrir-hilo]')!.dispatchEvent(p.evento("click")); });
		await p.escribir(p.campo("respuesta-hilo"), "porque sí");
		await act(async () => { p.doc.querySelector("[data-hilo-enviar]")!.dispatchEvent(p.evento("click")); });
		await p.esperar(80);
		assert.deepEqual(dicho.map(d => d.text), ["Entonces, ¿qué cambia?"]);
		const antes = cancelaciones;
		await p.escribir(p.campo("respuesta-hilo"), "otra cosa");
		assert.ok(cancelaciones > antes, "escribir en el hilo también detiene la lectura");
	});
});
