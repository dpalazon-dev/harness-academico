/**
 * Los personajes en la página del cuaderno (ticket 12g): el selector discreto de la cabecera, cada comentario firmado y
 * pintado con la tinta de su personaje (la neutra si el personaje se borró) y «Preguntar a…» en la barra de la selección.
 * Pintado en estático y, para la barra y el gestor, montado sobre linkedom.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";

// Radix elige sus efectos al importarse: se carga con un DOM, como en el navegador.
const bootstrap = parseHTML("<html><body></body></html>");
const bootstrapGlobals = new Map(["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, { window: bootstrap.window, document: bootstrap.document });
const { EditorCuadernoEstudio } = await import("../components/estudio/editor-cuadernos.tsx");
const { BarraSeleccion } = await import("../components/estudio/margen-cuaderno.tsx");
const { ContenidoGestor } = await import("../components/estudio/personaje-cuaderno.tsx");
for (const [key, descriptor] of bootstrapGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
import type { Comentario, Cuaderno } from "../components/estudio/cuadernos.ts";
import { colorDeTinta } from "../components/estudio/tintas.ts";
import { todos, type ListaPersonajes } from "../components/estudio/personajes.ts";

const nada = () => {};
const T = "2026-11-17T10:00:00.000Z";
const ESTADO = { tope: 40, usadas: 3, modeloEconomico: true };
const LISTA: ListaPersonajes = {
	predefinidos: [
		{ id: "profesor", nombre: "Profesor", descripcion: "Porqués y mecanismos", tinta: "acento", predefinido: true },
		{ id: "examinador", nombre: "Examinador", descripcion: "Preguntas para recuperar", tinta: "ambar", predefinido: true },
		{ id: "esceptico", nombre: "Escéptico", descripcion: "Condiciones, contraejemplos y fuentes", tinta: "rojo", predefinido: true },
		{ id: "companero", nombre: "Compañero", descripcion: "Analogías y conexiones con lo que ya sabes", tinta: "verde", predefinido: true },
	],
	propios: [{ id: "p-1", nombre: "Abogado del diablo", descripcion: "Defiende lo contrario de lo que escribo.", tinta: "texto", predefinido: false }],
	max: { personajes: 12, nombre: 40, descripcion: 400 },
};
const NOTA = { id: "b1", kind: "nota" as const, symbol: null, text: "Funciona siempre que no haya ciclos negativos.", locator: "", quote: "" };
const comentario = (persona: string, firma: string | undefined, id = "c1"): Comentario => ({
	id, persona, ...(firma ? { firma } : {}), kind: "pregunta", state: "abierto", createdAt: T,
	anchor: { blockId: "b1", text: "ciclos negativos", start: 28, end: 44, prefix: "no haya ", suffix: "." },
	thread: [{ id: `m-${id}`, role: "tutor", text: "¿Seguro?", at: T }],
});
const CUADERNO: Cuaderno = { id: "nb1", revision: 2, title: "Dijkstra", kind: "libre", unitId: null, documentId: null, areaId: null, createdAt: T, updatedAt: T, blocks: [NOTA] };
const ACCIONES = {
	cambiar: nada, exportarMarkdown: nada, exportarAnki: nada, borrar: nada, practicar: nada, navegar: nada, cambiarModo: nada, fijarTope: nada, fijarProposito: nada,
	elegirPersona: nada, guardarPersonaje: async () => {}, borrarPersonaje: async () => {}, comentar: nada,
};
const editor = (c: Cuaderno, personajes: ListaPersonajes | null = LISTA) => renderToStaticMarkup(
	<EditorCuadernoEstudio cuaderno={c} unidades={[]} documentos={[]} guardado={{ tipo: "guardado" }} ocupado={false} proactivo={{ estado: ESTADO, leyendo: false, error: null }}
		personajes={personajes} acciones={ACCIONES} />,
);
const escapar = (s: string) => s.replace(/[()%]/g, "\\$&");

describe("la cabecera con personaje, pintada", () => {
	it("muestra quién comenta solo: el Profesor si el cuaderno no eligió; el elegido si lo hizo; el Profesor si el elegido se borró", () => {
		assert.match(editor(CUADERNO), /<button[^>]*data-personaje[^>]*aria-label="Comenta solo: Profesor\. Cambiar de personaje\."/);
		assert.match(editor({ ...CUADERNO, persona: "esceptico" }), /aria-label="Comenta solo: Escéptico\./);
		assert.match(editor({ ...CUADERNO, persona: "p-1" }), /aria-label="Comenta solo: Abogado del diablo\./);
		assert.match(editor({ ...CUADERNO, persona: "p-borrado" }), /aria-label="Comenta solo: Profesor\./);
	});

	it("sigue siendo una línea discreta: el selector es un botón de texto y el menú y el gestor no están a la vista", () => {
		const html = editor(CUADERNO);
		assert.doesNotMatch(html, /Examinador|Tus personajes|data-gestor-personajes/);
		assert.equal((html.match(/data-block-id=/g) ?? []).length, 1);
	});

	it("sin la lista de personajes la cabecera es la de antes", () => {
		const html = editor(CUADERNO, null);
		assert.doesNotMatch(html, /data-personaje/);
		assert.match(html, /Propósito del cuaderno/);
	});
});

describe("cada comentario muestra quién lo escribió", () => {
	const margen = (comentarios: Comentario[], extra: Partial<Cuaderno> = {}, lista: ListaPersonajes | null = LISTA) =>
		editor({ ...CUADERNO, comments: comentarios, ...extra }, lista);

	it("la firma del personaje y su tinta, en la tarjeta y en el subrayado", () => {
		const html = margen([comentario("esceptico", "Escéptico")]);
		assert.match(html, /<span data-firma[^>]*>Escéptico<\/span>/);
		assert.match(html, new RegExp(`<article[^>]*--tinta-margen:${escapar(colorDeTinta("rojo"))}`));
		assert.match(html, new RegExp(`data-comentario="c1"[^>]*--tinta-margen:${escapar(colorDeTinta("rojo"))}`));
	});

	it("el Profesor (acento) y un comentario de antes siguen la tinta del cuaderno, sin imponer la suya", () => {
		const html = margen([comentario("profesor", "Profesor"), comentario("tutor", undefined, "c2")], { tinta: "verde" });
		assert.match(html, /<span data-firma[^>]*>Profesor<\/span>/);
		assert.match(html, /<span data-firma[^>]*>Tutor<\/span>/);
		assert.doesNotMatch(html, /<article[^>]*--tinta-margen:/);
		assert.match(html, new RegExp(`data-notebook-id="nb1"[^>]*--tinta-margen:${escapar(colorDeTinta("verde"))}`));
	});

	it("un personaje borrado: el comentario conserva su firma y cae a la tinta neutra", () => {
		const html = margen([comentario("p-borrado", "Abogado del diablo")]);
		assert.match(html, /<span data-firma[^>]*>Abogado del diablo<\/span>/);
		assert.match(html, new RegExp(`<article[^>]*--tinta-margen:${escapar(colorDeTinta("texto"))}`));
		assert.match(html, new RegExp(`data-comentario="c1"[^>]*--tinta-margen:${escapar(colorDeTinta("texto"))}`));
	});

	it("sin firma ni personaje conocido dice «Personaje borrado», no el id", () => {
		assert.match(margen([comentario("p-raro", undefined)]), /<span data-firma[^>]*>Personaje borrado<\/span>/);
	});
});

let root: Root | null = null;
let restore: (() => void) | null = null;
function montar() {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	const globals: Record<string, unknown> = {
		window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
		SVGElement: dom.window.SVGElement, ShadowRoot: dom.window.ShadowRoot, IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
	};
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	Object.assign(dom.window, { getComputedStyle: () => ({ getPropertyValue: () => "", animationName: "none", display: "block" }), matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
	Object.assign(dom.window.HTMLElement.prototype, { focus() {}, attachEvent() {}, detachEvent() {}, hasPointerCapture: () => false, scrollIntoView() {} });
	// linkedom no sincroniza `value` de un campo multilínea con lo que pone React: se guarda aparte, como en el navegador.
	const valores = new WeakMap<object, string>();
	Object.defineProperty(dom.window.HTMLTextAreaElement.prototype, "value", {
		configurable: true,
		get(this: HTMLTextAreaElement) { return valores.get(this) ?? this.textContent ?? ""; },
		set(this: HTMLTextAreaElement, v: string) { valores.set(this, String(v)); },
	});
	root = createRoot(dom.document.querySelector("#root")!);
	restore = () => { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); } };
	const evento = (tipo: string, extra: Record<string, unknown> = {}) => Object.assign(new dom.window.Event(tipo, { bubbles: true, cancelable: true }), extra);
	return { dom, evento };
}
afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	restore?.();
	restore = null;
});

describe("«Preguntar a…» en la barra de la selección", () => {
	it("cerrada solo suma un botón; sin personajes no hay botón", async () => {
		const f = montar();
		await act(async () => { root!.render(<BarraSeleccion pedir={nada} personajes={todos(LISTA)} />); });
		assert.equal(f.dom.document.querySelectorAll("[data-pedir]").length, 3, "Pregúntame, Explícamelo y Dibújalo");
		assert.ok(f.dom.document.querySelector("[data-preguntar-a]"));
		assert.equal(f.dom.document.querySelector("[data-personajes-barra]"), null, "la lista no está a la vista hasta pedirla");
		await act(async () => { root!.render(<BarraSeleccion pedir={nada} />); });
		assert.equal(f.dom.document.querySelector("[data-preguntar-a]"), null);
	});

	it("ofrece los cinco personajes y preguntar a uno pide una pregunta firmada por él, con ratón y con teclado", async () => {
		const f = montar();
		const pedidos: [string, string | undefined][] = [];
		await act(async () => { root!.render(<BarraSeleccion pedir={(k, p) => pedidos.push([k, p])} personajes={todos(LISTA)} />); });
		await act(async () => { f.dom.document.querySelector("[data-preguntar-a]")!.dispatchEvent(f.evento("mousedown")); });
		const opciones = [...f.dom.document.querySelectorAll<HTMLElement>("[data-pedir-a]")];
		assert.deepEqual(opciones.map(o => o.dataset.pedirA), ["profesor", "examinador", "esceptico", "companero", "p-1"]);
		assert.ok(opciones.every(o => o.hasAttribute("data-recorrido")), "Tab llega a cada personaje");
		await act(async () => { opciones[2]!.dispatchEvent(f.evento("mousedown")); });
		await act(async () => { opciones[3]!.dispatchEvent(f.evento("click", { detail: 0 })); });
		await act(async () => { opciones[3]!.dispatchEvent(f.evento("click", { detail: 1 })); });
		assert.deepEqual(pedidos, [["pregunta", "esceptico"], ["pregunta", "companero"]]);
	});

	it("a cada personaje también se le puede pedir «Explícamelo», con ratón y con teclado", async () => {
		const f = montar();
		const pedidos: [string, string | undefined][] = [];
		await act(async () => { root!.render(<BarraSeleccion pedir={(k, p) => pedidos.push([k, p])} personajes={todos(LISTA)} />); });
		await act(async () => { f.dom.document.querySelector("[data-preguntar-a]")!.dispatchEvent(f.evento("mousedown")); });
		const explicar = [...f.dom.document.querySelectorAll<HTMLElement>("[data-explicar-a]")];
		assert.deepEqual(explicar.map(o => o.dataset.explicarA), ["profesor", "examinador", "esceptico", "companero", "p-1"]);
		assert.ok(explicar.every(o => o.hasAttribute("data-recorrido") && /Explica/.test(o.getAttribute("aria-label") ?? "")), "Tab llega y el nombre accesible dice a quién");
		await act(async () => { explicar[2]!.dispatchEvent(f.evento("mousedown")); });
		await act(async () => { explicar[4]!.dispatchEvent(f.evento("click", { detail: 0 })); });
		assert.deepEqual(pedidos, [["explicacion", "esceptico"], ["explicacion", "p-1"]]);
	});

	it("«Pregúntame» sigue preguntando al del cuaderno: no manda personaje", async () => {
		const f = montar();
		const pedidos: [string, string | undefined][] = [];
		await act(async () => { root!.render(<BarraSeleccion pedir={(k, p) => pedidos.push([k, p])} personajes={todos(LISTA)} />); });
		await act(async () => { f.dom.document.querySelector("[data-pedir=pregunta]")!.dispatchEvent(f.evento("mousedown")); });
		assert.deepEqual(pedidos, [["pregunta", undefined]]);
	});
});

describe("el gestor de personajes", () => {
	it("crea un personaje con su nombre, su descripción y su tinta", async () => {
		const f = montar();
		const guardados: unknown[] = [];
		await act(async () => { root!.render(<ContenidoGestor lista={{ ...LISTA, propios: [] }} guardar={async c => { guardados.push(c); }} borrar={async () => {}} />); });
		const doc = f.dom.document;
		const nombre = doc.querySelector<HTMLInputElement>("input[name=nombre]")!;
		const descripcion = doc.querySelector<HTMLTextAreaElement>("textarea[name=descripcion]")!;
		assert.ok(nombre && descripcion, "sin personajes propios abre directamente el formulario");
		const poner = async (el: HTMLInputElement | HTMLTextAreaElement, valor: string) => {
			await act(async () => { el.value = valor; el.dispatchEvent(f.evento("input")); });
		};
		await poner(nombre, "Abogado del diablo");
		await poner(descripcion, "Defiende lo contrario.");
		await act(async () => { doc.querySelector("[data-tinta-personaje=rojo]")!.dispatchEvent(f.evento("click", { detail: 1 })); });
		await act(async () => { doc.querySelector("form")!.dispatchEvent(f.evento("submit")); });
		assert.deepEqual(guardados, [{ nombre: "Abogado del diablo", descripcion: "Defiende lo contrario.", tinta: "rojo" }]);
	});

	it("lista los propios con editar y borrar, y enseña el error del plugin tal cual", async () => {
		const f = montar();
		await act(async () => { root!.render(<ContenidoGestor lista={LISTA} guardar={async () => { throw new Error("Ya hay un personaje con ese nombre."); }} borrar={async () => {}} />); });
		const doc = f.dom.document;
		assert.match(doc.querySelector("[data-personaje-propio=p-1]")!.textContent!, /Abogado del diablo/);
		assert.ok(doc.querySelector("[aria-label='Editar a Abogado del diablo']"));
		assert.ok(doc.querySelector("[aria-label='Borrar a Abogado del diablo']"));
		await act(async () => { doc.querySelector("[aria-label='Editar a Abogado del diablo']")!.dispatchEvent(f.evento("click", { detail: 1 })); });
		assert.equal(doc.querySelector<HTMLInputElement>("input[name=nombre]")!.value, "Abogado del diablo");
		await act(async () => { doc.querySelector("form")!.dispatchEvent(f.evento("submit")); });
		assert.match(doc.querySelector("[role=alert]")!.textContent!, /Ya hay un personaje con ese nombre\./);
	});
});
