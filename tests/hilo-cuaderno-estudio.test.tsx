/**
 * Los hilos del margen del cuaderno (ticket 12c), montados de verdad sobre linkedom: el teclado y el foco no se ven en el
 * render estático. Abrir lleva el foco al campo; Intro envía y Mayús+Intro no; Escape cierra sin dar el hilo por atendido y
 * devuelve el foco a su tarjeta; «Volver a la nota» (clic o Ctrl+Intro) lo da por atendido y deja el cursor al final del
 * párrafo anclado; la marca del atendido reabre el hilo. Y la barra de «Pregúntame» funciona con teclado. linkedom no
 * maqueta ni mueve el foco por sí solo: `focus` y `setSelectionRange` se anotan en lugar de comprobar `activeElement`.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";

// Radix elige sus efectos al importarse: se carga con un DOM, como en el navegador.
const bootstrap = parseHTML("<html><body></body></html>");
const bootstrapGlobals = new Map(["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, { window: bootstrap.window, document: bootstrap.document });
const { EditorCuadernoEstudio } = await import("../components/estudio/editor-cuadernos.tsx");
const { BarraSeleccion } = await import("../components/estudio/margen-cuaderno.tsx");
for (const [key, descriptor] of bootstrapGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
import type { Cuaderno } from "../components/estudio/cuadernos.ts";
import { SIN_HILOS, type EstadoHilos } from "../components/estudio/margen.ts";

const NOTA = "Un embedding es un vector denso aprendido.";
const T = "2026-11-17T10:00:00.000Z";
const CUADERNO: Cuaderno = {
	id: "nb1", revision: 2, title: "Embeddings", kind: "libre", unitId: null, documentId: null, areaId: null, createdAt: T, updatedAt: T,
	blocks: [{ id: "n1", kind: "nota", symbol: null, text: NOTA, locator: "", quote: "" }],
	comments: [{
		id: "c1", persona: "tutor", kind: "pregunta", state: "abierto", createdAt: T,
		anchor: { blockId: "n1", text: "vector denso", start: 19, end: 31, prefix: "Un embedding es un ", suffix: " aprendido." },
		thread: [{ id: "m1", role: "tutor", text: "¿Denso respecto a qué?", at: T }],
	}],
};
const atendido = (c: Cuaderno): Cuaderno => ({ ...c, comments: c.comments!.map(x => ({ ...x, state: "atendido" as const })) });

let root: Root | null = null;
let restore: (() => void) | null = null;

interface Registro { focos: string[]; seleccion: string[]; llamadas: string[] }

function montar() {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	const registro: Registro = { focos: [], seleccion: [], llamadas: [] };
	const globals: Record<string, unknown> = {
		window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
		SVGElement: dom.window.SVGElement, ShadowRoot: dom.window.ShadowRoot, IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
	};
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	Object.assign(dom.window, { getSelection: () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 }), matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
	const nombre = (el: Element) => el.getAttribute("name") ?? (el.hasAttribute("data-abrir-hilo") ? "abrir-hilo" : el.getAttribute("data-block-id") ?? el.tagName.toLowerCase());
	Object.assign(dom.window.HTMLElement.prototype, {
		focus(this: HTMLElement) { registro.focos.push(nombre(this)); },
		// El seguimiento de cambios de React para navegadores sin `input` los pide al campo enfocado.
		attachEvent() {}, detachEvent() {},
		getBoundingClientRect() { return { x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }; },
		getClientRects() { return [{ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }]; },
	});
	// linkedom no sincroniza `value` de un campo de texto con lo que pone React: se guarda aparte, como en el navegador.
	const valores = new WeakMap<object, string>();
	Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, "defaultValue", {
		configurable: true,
		get(this: HTMLTextAreaElement) { return this.textContent ?? ""; },
		set(this: HTMLTextAreaElement, v: string) { this.textContent = String(v); },
	});
	Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, "value", {
		configurable: true,
		get(this: HTMLTextAreaElement) { return valores.get(this) ?? this.textContent ?? ""; },
		set(this: HTMLTextAreaElement, v: string) { valores.set(this, String(v)); },
	});
	Object.assign(dom.window.HTMLTextAreaElement.prototype, {
		setSelectionRange(this: HTMLTextAreaElement, a: number, b: number) { registro.seleccion.push(`${a}-${b}`); },
	});
	root = createRoot(dom.document.querySelector("#root")!);
	restore = () => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
	return { dom, registro };
}

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	restore?.();
	restore = null;
});

async function pintar(cuaderno: Cuaderno, hilos: EstadoHilos = SIN_HILOS, atender = true) {
	const f = montar();
	const { registro } = f;
	const acciones = {
		cambiar() {}, exportarMarkdown() {}, exportarAnki() {}, borrar() {}, practicar() {}, navegar() {},
		abrirHilo: (id: string) => { registro.llamadas.push(`abrir ${id}`); },
		cerrarHilo: (id: string) => { registro.llamadas.push(`cerrar ${id}`); },
		borradorHilo: (id: string, t: string) => { registro.llamadas.push(`borrador ${id} ${t}`); },
		responder: (id: string, t: string) => { registro.llamadas.push(`responder ${id} ${t}`); },
		reintentarHilo: (id: string) => { registro.llamadas.push(`reintentar ${id}`); },
		atender: async (id: string) => { registro.llamadas.push(`atender ${id}`); return atender; },
	};
	const dibujar = async (h: EstadoHilos) => {
		await act(async () => {
			root!.render(<EditorCuadernoEstudio cuaderno={cuaderno} unidades={[]} documentos={[]} guardado={{ tipo: "guardado" }} ocupado={false} hilos={h} acciones={acciones} />);
		});
	};
	await dibujar(hilos);
	/** linkedom no tiene KeyboardEvent ni MouseEvent: un evento con las propiedades que leen React y los manejadores. */
	const evento = (tipo: string, extra: Record<string, unknown> = {}) =>
		Object.assign(new f.dom.window.Event(tipo, { bubbles: true, cancelable: true }), { key: "", shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, detail: 1, button: 0, ...extra });
	const q = <E extends Element>(sel: string) => f.dom.document.querySelector<E>(sel);
	// React sigue el campo enfocado para detectar cambios (linkedom no tiene el evento `input`): sin `focusin` no hay campo activo.
	const tecla = async (el: Element, key: string, extra: Record<string, unknown> = {}) => {
		await act(async () => { el.dispatchEvent(evento("focusin")); el.dispatchEvent(evento("keydown", { key, ...extra })); });
	};
	const clic = async (el: Element, extra: Record<string, unknown> = {}) => { await act(async () => { el.dispatchEvent(evento("click", extra)); }); };
	return { ...f, acciones, dibujar, q, tecla, clic };
}

const ABIERTO: EstadoHilos = { abierto: "c1", borradores: {}, espera: {} };

it("abrir un hilo lleva el foco a su campo; la tarjeta cerrada ofrece «Responder» y la página sigue siendo la de David", async () => {
	const cerrado = await pintar(CUADERNO);
	assert.match(cerrado.q("[data-margen-id=c1]")!.textContent!, /¿Denso respecto a qué\?/);
	assert.equal(cerrado.q("[data-abrir-hilo]")!.textContent!.trim(), "Responder");
	await cerrado.clic(cerrado.q("[data-abrir-hilo]")!);
	assert.deepEqual(cerrado.registro.llamadas, ["abrir c1"]);
	const abierto = await pintar(CUADERNO, ABIERTO);
	assert.ok(abierto.registro.focos.includes("respuesta-hilo"), `el foco fue a ${abierto.registro.focos.join(", ")}`);
	assert.equal(abierto.q<HTMLTextAreaElement>('textarea[name="text"]')!.value, NOTA, "el texto de David no cambia");
});

it("Intro envía lo escrito; Mayús+Intro, no; vacío o esperando, tampoco", async () => {
	const f = await pintar(CUADERNO, { ...ABIERTO, borradores: { c1: "Frente a one-hot." } });
	const campo = f.q('textarea[name="respuesta-hilo"]')!;
	await f.tecla(campo, "Enter", { shiftKey: true });
	assert.deepEqual(f.registro.llamadas, []);
	await f.tecla(campo, "Enter");
	assert.deepEqual(f.registro.llamadas, ["responder c1 Frente a one-hot."]);
	await f.dibujar({ ...ABIERTO, borradores: { c1: "   " } });
	await f.tecla(f.q('textarea[name="respuesta-hilo"]')!, "Enter");
	await f.dibujar({ ...ABIERTO, borradores: { c1: "Otra" }, espera: { c1: { estado: "pensando", pendiente: "Frente a one-hot." } } });
	await f.tecla(f.q('textarea[name="respuesta-hilo"]')!, "Enter");
	assert.deepEqual(f.registro.llamadas, ["responder c1 Frente a one-hot."]);
});

it("Escape cierra el hilo sin darlo por atendido y devuelve el foco a su tarjeta", async () => {
	const f = await pintar(CUADERNO, ABIERTO);
	await f.tecla(f.q('textarea[name="respuesta-hilo"]')!, "Escape");
	assert.deepEqual(f.registro.llamadas, ["cerrar c1"], "no se llama a atender");
	f.registro.focos.length = 0;
	await f.dibujar(SIN_HILOS);
	assert.deepEqual(f.registro.focos, ["abrir-hilo"], "el foco vuelve al botón que abre el hilo");
});

it("«Volver a la nota» lo da por atendido, cierra el hilo y deja el cursor al final del párrafo anclado", async () => {
	const f = await pintar(CUADERNO, ABIERTO);
	f.registro.focos.length = 0;
	await f.clic(f.q("[data-hilo-volver]")!);
	assert.deepEqual(f.registro.llamadas, ["atender c1", "cerrar c1"]);
	assert.equal(f.registro.focos.at(-1), "text", "el foco va al campo del párrafo");
	assert.equal(f.registro.seleccion.at(-1), `${NOTA.length}-${NOTA.length}`, "con el cursor al final");
	const g = await pintar(CUADERNO, ABIERTO);
	await g.tecla(g.q('textarea[name="respuesta-hilo"]')!, "Enter", { ctrlKey: true });
	assert.deepEqual(g.registro.llamadas, ["atender c1", "cerrar c1"], "Ctrl+Intro también vuelve a la nota");
});

it("si no se pudo marcar como atendido el hilo sigue abierto y el cursor donde estaba", async () => {
	const f = await pintar(CUADERNO, ABIERTO, false);
	f.registro.focos.length = 0;
	await f.clic(f.q("[data-hilo-volver]")!);
	assert.deepEqual(f.registro.llamadas, ["atender c1"]);
	assert.deepEqual(f.registro.focos, []);
});

it("un comentario atendido es una marca que reabre el hilo con su historia", async () => {
	const f = await pintar(atendido({ ...CUADERNO, comments: [{ ...CUADERNO.comments![0]!, thread: [...CUADERNO.comments![0]!.thread, { id: "m2", role: "david", text: "Frente a one-hot.", at: T }] }] }));
	const marca = f.q("[data-margen-id=c1] [data-abrir-hilo]")!;
	assert.match(marca.getAttribute("aria-label")!, /^Reabrir el hilo atendido: «vector denso»/);
	assert.doesNotMatch(f.q("[data-margen-id=c1]")!.textContent!, /Denso respecto/, "solo la marca, sin el texto");
	assert.equal(f.q("[data-comentario]"), null, "la frase ya no va subrayada");
	await f.clic(marca);
	assert.deepEqual(f.registro.llamadas, ["abrir c1"]);
});

it("con un error, «Reintentar» repite lo que faltó", async () => {
	const f = await pintar(CUADERNO, { ...ABIERTO, espera: { c1: { estado: "error", error: "El modelo falló: caído" } } });
	assert.match(f.q("[role=alert]")!.textContent!, /El modelo falló: caído/);
	await f.clic([...f.dom.document.querySelectorAll("button")].find(b => b.textContent === "Reintentar")!);
	assert.deepEqual(f.registro.llamadas, ["reintentar c1"]);
});

it("la barra de «Pregúntame» funciona con teclado: Intro en el botón pide, y se queda mientras el foco esté en ella", async () => {
	const f = montar();
	const pedidos: string[] = [];
	const salidas: number[] = [];
	await act(async () => { root!.render(<BarraSeleccion pedir={(k) => pedidos.push(k)} alSalir={() => salidas.push(1)} />); });
	const botones = [...f.dom.document.querySelectorAll<HTMLElement>("[data-pedir]")];
	assert.ok(botones.every(b => b.hasAttribute("data-recorrido")), "Tab llega a los botones");
	const evento = (tipo: string, extra: Record<string, unknown>) => Object.assign(new f.dom.window.Event(tipo, { bubbles: true, cancelable: true }), extra);
	// Intro sobre un botón llega como clic sin ratón (`detail` 0); un clic de ratón ya pidió con `mousedown`.
	await act(async () => { botones[0]!.dispatchEvent(evento("click", { detail: 0 })); });
	await act(async () => { botones[1]!.dispatchEvent(evento("click", { detail: 1 })); });
	assert.deepEqual(pedidos, ["pregunta"]);
	await act(async () => { botones[1]!.dispatchEvent(evento("mousedown", {})); });
	assert.deepEqual(pedidos, ["pregunta", "explicacion"]);
	const barra = f.dom.document.querySelector("[data-barra-seleccion]")!;
	await act(async () => { barra.dispatchEvent(evento("focusout", { relatedTarget: botones[1] })); });
	assert.deepEqual(salidas, [], "el foco pasa de un botón al otro: se queda");
	await act(async () => { barra.dispatchEvent(evento("focusout", { relatedTarget: null })); });
	assert.deepEqual(salidas, [1], "el foco sale de la barra: se cierra");
});

it("Escape en la barra la cierra y devuelve el foco al párrafo", async () => {
	const f = montar();
	const salidas: (boolean | undefined)[] = [];
	await act(async () => { root!.render(<BarraSeleccion pedir={() => {}} alSalir={(volver) => salidas.push(volver)} />); });
	const evento = Object.assign(new f.dom.window.Event("keydown", { bubbles: true, cancelable: true }), { key: "Escape" });
	await act(async () => { f.dom.document.querySelector("[data-pedir]")!.dispatchEvent(evento); });
	assert.deepEqual(salidas, [true]);
});
