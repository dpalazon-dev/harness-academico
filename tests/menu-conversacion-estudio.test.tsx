/**
 * El menú de cada conversación de la barra lateral (ticket 12), montado de
 * verdad: el menú de Radix solo existe abierto y en un portal, así que el
 * render estático no lo ve. Clic derecho abre el menú, «Renombrar» y F2
 * abren la fila de renombrado del núcleo, y «Exportar» y «Borrar…» llaman a
 * sus acciones. Recorrerlo con las flechas es cosa de Radix y depende de la
 * gestión de foco del navegador, que linkedom no reproduce: se comprueba en
 * la app. De paso, pulsar la cabecera de una sección pide plegarla (ticket 01
 * de la segunda ronda). Mismo arreglo de DOM que passive-tooltip.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { installModalDom } from "./modal-dom.ts";

// Radix elige sus efectos al importarse: se carga con un DOM, como en el navegador.
const bootstrap = parseHTML("<html><body></body></html>");
const bootstrapGlobals = new Map(["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, { window: bootstrap.window, document: bootstrap.document });
const { SidebarProvider } = await import("../components/ui/sidebar.tsx");
const { BarraLateralEstudio } = await import("../components/estudio/barra-lateral.tsx");
for (const [key, descriptor] of bootstrapGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }

let root: Root | null = null;
let restore: (() => void) | null = null;

function montar() {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	const globals: Record<string, unknown> = {
		window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element,
		SVGElement: dom.window.SVGElement, ShadowRoot: dom.window.ShadowRoot, IS_REACT_ACT_ENVIRONMENT: true,
		ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
		DOMRect: class { x = 0; y = 0; width = 0; height = 0; top = 0; left = 0; right = 0; bottom = 0; static fromRect() { return new this(); } toJSON() {} },
	};
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	const restoreModal = installModalDom(dom);
	const getSelection = () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 });
	Object.assign(dom.window, { getSelection, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) });
	// La fila de renombrado selecciona el título al entrar; linkedom no tiene `select`.
	Object.assign(dom.window.HTMLInputElement.prototype, { select() {} });
	// Sin atributo, el tipo de un campo es «text», como en el navegador; React solo vigila los cambios de los de texto.
	Object.defineProperty(dom.window.HTMLInputElement.prototype, "type", { configurable: true, get(this: HTMLInputElement) { return this.getAttribute("type") ?? "text"; } });
	// Intro en la fila de renombrado la desenfoca y el desenfoque guarda: React lo oye como focusout.
	Object.assign(dom.window.HTMLElement.prototype, { blur(this: HTMLElement) { this.dispatchEvent(new dom.window.Event("focusout", { bubbles: true })); dom.document.body.focus(); } });
	const llamadas: string[] = [];
	const nada = () => {};
	const acciones = {
		elegirEspacio: nada, crearEspacio: nada, renombrarEspacio: nada, archivarEspacio: nada, recuperarEspacio: nada, traerSinEspacio: nada, moverPlan: nada, abrirAjustes: nada, navegar: nada, abrirPaleta: nada,
		renombrarConversacion: (id: string, titulo: string) => { llamadas.push(`renombrar ${id} ${titulo}`); },
		exportarConversacion: (id: string) => { llamadas.push(`exportar ${id}`); },
		resumirConversacion: (id: string) => { llamadas.push(`resumir ${id}`); },
		borrarConversacion: (c: { id: string }) => { llamadas.push(`borrar ${c.id}`); },
		alternarSeccion: (seccion: string) => { llamadas.push(`alternar ${seccion}`); },
		abrirPorDecidir: () => { llamadas.push("por decidir"); }, cambiarFiltros: nada,
	};
	root = createRoot(dom.document.querySelector("#root")!);
	restore = () => {
		restoreModal();
		for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
	};
	return { dom, llamadas, acciones };
}

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	restore?.();
	restore = null;
});

async function pintar(filtros?: { agrupar: "fecha" | "unidad"; actividad: "toda"; fecha: "siempre" }) {
	const f = montar();
	await act(async () => {
		root!.render(
			<SidebarProvider open onOpenChange={() => {}}>
				<BarraLateralEstudio
					espacios={{ areas: [], activeAreaId: null }}
					conversaciones={[
						{ id: "c1", title: "Qué es un grafo", updatedAt: "2026-11-12T10:00:00", origen: "libre", unidad: null, plan: null },
						{ id: "c2", title: "Caminos mínimos", updatedAt: "2026-11-12T09:00:00", origen: "libre", unidad: null, plan: null },
					]}
					plan={{ plan: null, unidades: [] }}
					ruta="/"
					ahora={new Date("2026-11-12T18:00:00")}
					acciones={f.acciones}
					filtros={filtros}
				/>
			</SidebarProvider>,
		);
	});
	const filas = [...f.dom.document.querySelectorAll<HTMLElement>('[data-testid="conversacion"]')];
	const menu = () => f.dom.document.querySelector<HTMLElement>('[data-testid="menu-conversacion"]');
	const opciones = () => [...(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
	/** linkedom no tiene KeyboardEvent ni MouseEvent: un evento con las propiedades que leen React y Radix. */
	const evento = (tipo: string, extra: Record<string, unknown> = {}) =>
		Object.assign(new f.dom.window.Event(tipo, { bubbles: true, cancelable: true }), { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, button: 0, ...extra });
	const tecla = async (el: Element, key: string) => {
		await act(async () => { el.dispatchEvent(evento("keydown", { key })); });
	};
	const abrirConClicDerecho = async (fila: HTMLElement) => {
		await act(async () => { fila.dispatchEvent(evento("contextmenu", { button: 2 })); });
	};
	return { ...f, filas, menu, opciones, tecla, abrirConClicDerecho };
}

it("clic derecho abre el menú de esa conversación con Renombrar, Exportar, Resumir y Borrar, en ese orden", async () => {
	const p = await pintar();
	assert.equal(p.menu(), null, "cerrado hasta que se pide");
	await p.abrirConClicDerecho(p.filas[1]!);
	assert.deepEqual(p.opciones().map(o => o.textContent), ["RenombrarF2", "Exportar como Markdown", "Resumir ahora", "Borrar…"]);
});

it("pulsar la cabecera de una sección la pliega o despliega (ticket 01 de la segunda ronda)", async () => {
	const p = await pintar();
	for (const seccion of ["conversaciones", "plan", "materiales"]) {
		await act(async () => { p.dom.document.querySelector<HTMLElement>(`[data-seccion="${seccion}"]`)!.click(); });
	}
	assert.deepEqual(p.llamadas, ["alternar conversaciones", "alternar plan", "alternar materiales"]);
});

it("«Exportar como Markdown» exporta esa conversación y cierra el menú", async () => {
	const p = await pintar();
	await p.abrirConClicDerecho(p.filas[0]!);
	await act(async () => { p.opciones()[1]!.click(); });
	assert.deepEqual(p.llamadas, ["exportar c1"]);
	assert.equal(p.menu(), null);
});

it("«Resumir ahora» pide el resumen de esa conversación (ticket 11)", async () => {
	const p = await pintar();
	await p.abrirConClicDerecho(p.filas[1]!);
	await act(async () => { p.opciones()[2]!.click(); });
	assert.deepEqual(p.llamadas, ["resumir c2"]);
});

it("«Borrar…» pide el diálogo de borrado para esa conversación", async () => {
	const p = await pintar();
	await p.abrirConClicDerecho(p.filas[1]!);
	await act(async () => { p.opciones()[3]!.click(); });
	assert.deepEqual(p.llamadas, ["borrar c2"]);
});

it("«Renombrar» y F2 abren la fila de renombrado del núcleo; Intro guarda y Escape descarta", async () => {
	const p = await pintar();
	await p.abrirConClicDerecho(p.filas[0]!);
	await act(async () => { p.opciones()[0]!.click(); });
	// Radix devuelve el foco (y avisa con onCloseAutoFocus) en el tick siguiente al cierre.
	await act(async () => { await new Promise(r => setTimeout(r, 0)); });
	const campo = () => p.dom.document.querySelector<HTMLInputElement>('[data-testid="session-rename-input"]');
	assert.equal(campo()?.value, "Qué es un grafo");
	await p.tecla(campo()!, "Escape");
	assert.equal(campo(), null);
	assert.deepEqual(p.llamadas, []);

	// F2 sobre la fila enfocada renombra esa fila, no la conversación abierta.
	const fila = p.dom.document.querySelectorAll<HTMLElement>('[data-testid="conversacion"]')[1]!;
	await p.tecla(fila, "F2");
	assert.equal(campo()?.value, "Caminos mínimos");
	await act(async () => {
		const input = campo()!;
		input.focus();
		// El setter del prototipo, no el de la instancia, que React vigila: así ve el cambio.
		Object.getOwnPropertyDescriptor(p.dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "Dijkstra y Bellman-Ford");
		input.dispatchEvent(new p.dom.window.Event("input", { bubbles: true }));
		// Sobre linkedom, React detecta el cambio al soltar la tecla.
		input.dispatchEvent(Object.assign(new p.dom.window.Event("keyup", { bubbles: true }), { key: "d" }));
	});
	await p.tecla(campo()!, "Enter");
	assert.equal(campo(), null, "la fila vuelve a su título");
	assert.deepEqual(p.llamadas, ["renombrar c2 Dijkstra y Bellman-Ford"]);
});

it("con la fila enfocada, la tecla de menú y Mayús+F10 abren su menú", async () => {
	const p = await pintar();
	await p.tecla(p.filas[0]!, "ContextMenu");
	assert.equal(p.opciones().length, 4);
	await p.tecla(p.menu()!, "Escape");
	assert.equal(p.menu(), null);
	await act(async () => {
		p.filas[1]!.dispatchEvent(Object.assign(new p.dom.window.Event("keydown", { bubbles: true, cancelable: true }), { key: "F10", shiftKey: true, metaKey: false, ctrlKey: false, altKey: false }));
	});
	assert.equal(p.opciones().length, 4);
	await act(async () => { p.opciones()[3]!.click(); });
	assert.deepEqual(p.llamadas, ["borrar c2"]);
});

it("agrupadas por plan (ticket 03 de la segunda ronda), el menú, Exportar, Borrar y F2 siguen en cada fila", async () => {
	const p = await pintar({ agrupar: "unidad", actividad: "toda", fecha: "siempre" });
	// El montaje tiene «Todos» activo: agrupar por unidad es aquí por plan, y estas conversaciones no tienen.
	assert.match(p.dom.document.body.innerHTML, /Sin plan/);
	await p.abrirConClicDerecho(p.filas[1]!);
	await act(async () => { p.opciones()[1]!.click(); });
	await p.abrirConClicDerecho(p.filas[0]!);
	await act(async () => { p.opciones()[3]!.click(); });
	await p.tecla(p.filas[1]!, "F2");
	assert.equal(p.dom.document.querySelector<HTMLInputElement>('[data-testid="session-rename-input"]')?.value, "Caminos mínimos");
	assert.deepEqual(p.llamadas, ["exportar c2", "borrar c1"]);
});
