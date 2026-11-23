/**
 * Las acciones rápidas del inicio (ticket 04 de la segunda ronda), montadas de
 * verdad: lo que hace cada ficha al pulsarla. El menú de «Ponerme a prueba» es
 * de Radix y solo existe abierto y en un portal, y el campo del plan y el foco
 * de la caja dependen del estado: el render estático no los ve. Mismo arreglo
 * de DOM que menu-espacio-estudio.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { installModalDom } from "./modal-dom.ts";
import type { LecturaInicio } from "../components/estudio/tipos.ts";
import type { UnidadActiva } from "../components/estudio/inicio.tsx";

// Radix elige sus efectos al importarse: se carga con un DOM, como en el navegador.
const bootstrap = parseHTML("<html><body></body></html>");
const bootstrapGlobals = new Map(["window", "document"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, { window: bootstrap.window, document: bootstrap.document });
const { InicioEstudio } = await import("../components/estudio/inicio.tsx");
for (const [key, descriptor] of bootstrapGlobals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }

let root: Root | null = null;
let restore: (() => void) | null = null;

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	// Desmontado abierto, Radix devuelve el foco en el tick siguiente: que ocurra con el DOM todavía instalado.
	await new Promise(r => setTimeout(r, 0));
	root = null;
	restore?.();
	restore = null;
});

const SIN_PLAN: LecturaInicio = { paso: null, pasos: [], repasos: [], proximos: [], abierto: null };
const CON_PLAN: LecturaInicio = {
	...SIN_PLAN,
	paso: { unitId: "u2", titulo: "Árboles de expansión", tipo: "volcado", accion: "Escribe lo que ya sabes", motivo: "Sin volcado inicial no podrás ver después qué cambió.", boton: "Escribir volcado" },
	repasos: [
		{ unitId: "u4", titulo: "Flujo máximo", tarea: "libre", intentoId: "a1", fecha: null },
		{ unitId: "u1", titulo: "Recorridos BFS y DFS", tarea: "guiada", intentoId: null, fecha: "2026-11-10" },
	],
	abierto: { chatId: "c1", titulo: "Dudas de Dijkstra", fecha: "2026-11-12T10:00:00.000Z", abierto: ["¿Por qué falla con pesos negativos?"], siguiente: "" },
};
const UNIDADES: UnidadActiva[] = [{ id: "u1", titulo: "Recorridos BFS y DFS" }, { id: "u2", titulo: "Árboles de expansión" }];

async function montar(lectura: LecturaInicio, unidades: UnidadActiva[] = [], sinPlanes = lectura.paso === null) {
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
	Object.assign(dom.window, {
		getSelection: () => ({ anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 }),
		matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
	});
	// Sin atributo, el tipo de un campo es «text», como en el navegador; React solo vigila los cambios de los de texto.
	Object.defineProperty(dom.window.HTMLInputElement.prototype, "type", { configurable: true, get(this: HTMLInputElement) { return this.getAttribute("type") ?? "text"; } });
	restore = () => {
		restoreModal();
		for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key); }
	};
	const llamadas: string[] = [];
	const nada = () => {};
	const acciones = {
		enviar: nada, abrirUnidad: nada,
		paso: (p: { tipo: string; unitId: string }) => { llamadas.push(`paso ${p.tipo} ${p.unitId}`); },
		repasar: (r: { unitId: string; intentoId: string | null }) => { llamadas.push(`repasar ${r.unitId} ${r.intentoId}`); },
		retomar: (chatId: string) => { llamadas.push(`retomar ${chatId}`); },
		crearPlan: (objetivo: string) => { llamadas.push(`crear-plan ${objetivo}`); },
		ponerAPrueba: (unitId: string) => { llamadas.push(`prueba ${unitId}`); },
		anadirMaterial: () => { llamadas.push("material"); },
		abrirVolcado: (unitId: string) => { llamadas.push(`volcado ${unitId}`); },
	};
	root = createRoot(dom.document.querySelector("#root")!);
	/** Pinta el inicio con una lectura; volver a llamarla es la relectura tras una operación. */
	const pintar = async (l: LecturaInicio, sinPl = sinPlanes) => {
		await act(async () => {
			root!.render(<InicioEstudio espacio="Grafos" lectura={l} unidades={unidades} sinPlanes={sinPl} agenda={{ datos: null, onRangos: () => {} }} ritmo={null} ocupado={false} error={null} acciones={acciones} />);
		});
	};
	await pintar(lectura);
	const ficha = (nombre: string) => dom.document.querySelector<HTMLElement>(`[data-ficha="${nombre}"]`);
	const pulsar = async (nombre: string) => {
		const el = ficha(nombre);
		assert.ok(el, `ficha «${nombre}»`);
		await act(async () => { el.click(); });
	};
	const caja = () => dom.document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mensaje al tutor"]')!;
	return { dom, llamadas, ficha, pulsar, caja, pintar };
}

it("«Crear plan» despliega el campo del objetivo, que crea el plan con lo escrito", async () => {
	const m = await montar(SIN_PLAN);
	assert.equal(m.dom.document.querySelector('[data-testid="nuevo-plan"]'), null, "plegado hasta pulsarla");
	await m.pulsar("crear-plan");
	const campo = m.dom.document.querySelector<HTMLInputElement>('input[aria-label="Objetivo del plan"]');
	assert.ok(campo, "el campo aparece");
	assert.equal(m.dom.document.activeElement, campo, "con el foco puesto");
	await act(async () => {
		// El setter del prototipo, no el de la instancia, que React vigila: así ve el cambio.
		Object.getOwnPropertyDescriptor(m.dom.window.HTMLInputElement.prototype, "value")!.set!.call(campo, "Entender las GNN");
		campo.dispatchEvent(new m.dom.window.Event("input", { bubbles: true }));
		// Sobre linkedom, React detecta el cambio al soltar la tecla.
		campo.dispatchEvent(Object.assign(new m.dom.window.Event("keyup", { bubbles: true }), { key: "N" }));
	});
	// linkedom no tiene requestSubmit: el envío del formulario es el evento que oye React.
	await act(async () => { m.dom.document.querySelector('[data-testid="nuevo-plan"]')!.dispatchEvent(new m.dom.window.Event("submit", { bubbles: true, cancelable: true })); });
	assert.deepEqual(m.llamadas, ["crear-plan Entender las GNN"]);
});

it("con un plan ya creado, el campo del objetivo desaparece con su ficha: otro se crea con el «+» de la barra", async () => {
	const m = await montar(SIN_PLAN);
	await m.pulsar("crear-plan");
	assert.ok(m.dom.document.querySelector('[data-testid="nuevo-plan"]'));
	await m.pintar(SIN_PLAN, false);
	assert.equal(m.ficha("crear-plan"), null);
	assert.equal(m.dom.document.querySelector('[data-testid="nuevo-plan"]'), null);
});

it("«Continuar» ejecuta el paso propuesto principal", async () => {
	const m = await montar(CON_PLAN);
	await m.pulsar("continuar");
	assert.deepEqual(m.llamadas, ["paso volcado u2"]);
});

it("«Repasar» abre el primero de los repasos, no un intento a medias", async () => {
	const m = await montar(CON_PLAN);
	await m.pulsar("repasar");
	assert.deepEqual(m.llamadas, ["repasar u1 null"]);
});

it("«Retomar» abre la conversación con algo abierto", async () => {
	const m = await montar(CON_PLAN);
	await m.pulsar("retomar");
	assert.deepEqual(m.llamadas, ["retomar c1"]);
});

it("«Ponerme a prueba» lista las unidades activas del plan y abre la práctica de la elegida", async () => {
	const m = await montar(CON_PLAN, UNIDADES);
	/** linkedom no tiene KeyboardEvent: un evento con las propiedades que leen React y Radix. */
	await act(async () => {
		m.ficha("prueba")!.dispatchEvent(Object.assign(new m.dom.window.Event("keydown", { bubbles: true, cancelable: true }), { key: "Enter", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }));
	});
	const opciones = [...m.dom.document.querySelectorAll<HTMLElement>('[role="menuitem"]')];
	assert.deepEqual(opciones.map(o => o.textContent), ["Recorridos BFS y DFS", "Árboles de expansión"]);
	await act(async () => { opciones[1]!.click(); });
	assert.deepEqual(m.llamadas, ["prueba u2"]);
});

it("«Añadir material» lleva a Biblioteca", async () => {
	const m = await montar(SIN_PLAN);
	await m.pulsar("material");
	assert.deepEqual(m.llamadas, ["material"]);
});

it("«Añadir contexto» abre el volcado de la unidad de contexto si aún no lo tiene", async () => {
	const m = await montar(CON_PLAN);
	await m.pulsar("contexto");
	assert.deepEqual(m.llamadas, ["volcado u2"]);
});

/** Pulsa «Añadir contexto» con el foco fuera y comprueba que la caja lo recibe con una indicación nueva. */
async function enfocaLaCaja(lectura: LecturaInicio) {
	const m = await montar(lectura);
	const antes = m.caja().getAttribute("placeholder");
	await act(async () => { m.dom.document.body.focus(); });
	await m.pulsar("contexto");
	assert.deepEqual(m.llamadas, []);
	assert.equal(m.dom.document.activeElement, m.caja(), "la caja recibe el foco");
	assert.notEqual(m.caja().getAttribute("placeholder"), antes);
	assert.match(m.caja().getAttribute("placeholder")!, /lo que ya sabes/);
}

it("«Añadir contexto» sin unidad de contexto enfoca la caja con una indicación", async () => {
	await enfocaLaCaja(SIN_PLAN);
});

it("«Añadir contexto» con la unidad de contexto ya volcada enfoca la caja con una indicación", async () => {
	await enfocaLaCaja({ ...CON_PLAN, paso: { ...CON_PLAN.paso!, tipo: "tutor", accion: "Estudia con el tutor", motivo: "Tienes el volcado pero ninguna fuente.", boton: "Estudiar con el tutor" } });
});

it("quitar la unidad de contexto hace que «Añadir contexto» enfoque la caja", async () => {
	const m = await montar(CON_PLAN);
	await act(async () => { m.dom.document.querySelector<HTMLElement>('[aria-label="Quitar la unidad de contexto"]')!.click(); });
	await m.pulsar("contexto");
	assert.deepEqual(m.llamadas, []);
	assert.equal(m.dom.document.activeElement, m.caja());
});
