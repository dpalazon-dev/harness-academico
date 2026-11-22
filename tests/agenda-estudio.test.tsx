/**
 * La agenda del inicio montada de verdad (ticket 05 de la segunda ronda): lo
 * que hacen sus botones y qué rangos pide leer. El render estático no ve el
 * estado; mismo arreglo de DOM que acciones-rapidas-estudio.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, it } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { AgendaInicio, type AccionesAgenda, type Rango } from "../components/estudio/agenda.tsx";
import type { DiaAgenda } from "../components/estudio/tipos.ts";

let root: Root | null = null;
let restore: (() => void) | null = null;
afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	restore?.();
	restore = null;
});

// Sábado 14 de noviembre de 2026.
const AHORA = new Date("2026-11-14T10:00:00");
const DIAS: DiaAgenda[] = [
	{ dia: "2026-11-14", hecho: [], pendientes: [{ tipo: "repaso", unitId: "u1", titulo: "Flujo", tarea: "libre", intentoId: null, fecha: "2026-11-11", vencidoDias: 3 }] },
	{ dia: "2026-11-16", hecho: [], pendientes: [{ tipo: "repaso", unitId: "u2", titulo: "Cortes", tarea: "libre", intentoId: null, fecha: "2026-11-16", vencidoDias: 0 }] },
	{ dia: "2026-11-10", pendientes: [], hecho: [{ tipo: "conversacion", chatId: "c1", titulo: "Dudas de Dijkstra", unitId: null }] },
];

async function montar() {
	const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
	const globals: Record<string, unknown> = { window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, IS_REACT_ACT_ENVIRONMENT: true };
	const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	Object.assign(globalThis, globals);
	restore = () => { for (const [key, d] of saved) { if (d) Object.defineProperty(globalThis, key, d); else Reflect.deleteProperty(globalThis, key); } };
	const llamadas: string[] = [];
	const pedidos: { visible: Rango; seleccion: Rango }[] = [];
	const acciones: AccionesAgenda = {
		repasar: r => llamadas.push(`repasar ${r.unitId}`), paso: p => llamadas.push(`paso ${p.unitId}`),
		abrirUnidad: id => llamadas.push(`unidad ${id}`), abrirConversacion: id => llamadas.push(`conversacion ${id}`),
	};
	root = createRoot(dom.document.getElementById("root")!);
	await act(async () => {
		root!.render(<AgendaInicio datos={{ hoy: "2026-11-14", dias: Object.fromEntries(DIAS.map(d => [d.dia, d])) }} ahora={AHORA} ocupado={false} acciones={acciones} onRangos={r => pedidos.push(r)} />);
	});
	const doc = dom.document;
	const botones = () => [...doc.querySelectorAll("button")] as HTMLButtonElement[];
	const boton = (texto: string | RegExp) => {
		const b = botones().find(x => (typeof texto === "string" ? x.textContent?.trim() === texto : texto.test(x.textContent ?? "")));
		assert.ok(b, `no hay botón ${texto}`);
		return b!;
	};
	const pulsar = async (b: Element) => { await act(async () => { (b as HTMLElement).click(); }); };
	const dia = (d: string) => doc.querySelector(`[data-dia="${d}"]`) as HTMLButtonElement | null;
	const diasPintados = () => [...doc.querySelectorAll("[data-dia]")].map(x => x.getAttribute("data-dia"));
	const cabecera = () => doc.querySelector('[data-agenda="lista"] h2')?.textContent;
	return { doc, boton, pulsar, dia, diasPintados, cabecera, llamadas, pedidos };
}

it("pide la semana actual al abrir, se despliega al mes, navega entre meses y se repliega", async () => {
	const a = await montar();
	assert.deepEqual(a.pedidos.at(-1), { visible: { desde: "2026-11-09", hasta: "2026-11-15" }, seleccion: { desde: "2026-11-14", hasta: "2026-11-14" } });
	assert.equal(a.diasPintados().length, 7);

	await a.pulsar(a.boton("Ver el mes"));
	assert.equal(a.diasPintados().length, 42);
	assert.deepEqual(a.pedidos.at(-1)!.visible, { desde: "2026-10-26", hasta: "2026-12-06" });

	await a.pulsar(a.doc.querySelector(".rdp-button_next")!);
	assert.equal(a.diasPintados()[0], "2026-11-30", "diciembre empieza en la semana del lunes 30");
	assert.deepEqual(a.pedidos.at(-1)!.visible, { desde: "2026-11-30", hasta: "2027-01-03" });
	await a.pulsar(a.doc.querySelector(".rdp-button_previous")!);
	await a.pulsar(a.doc.querySelector(".rdp-button_previous")!);
	assert.equal(a.diasPintados()[0], "2026-09-28", "octubre");

	await a.pulsar(a.boton("Ver solo esta semana"));
	assert.deepEqual(a.diasPintados(), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
});

it("pulsar un día lo selecciona; «Próximos 7 días» va de hoy a hoy+6 y «Hoy» vuelve", async () => {
	const a = await montar();
	await a.pulsar(a.dia("2026-11-10")!);
	assert.equal(a.cabecera(), "Martes, 10 nov");
	assert.match(a.doc.querySelector('[data-agenda="lista"]')!.textContent!, /Dudas de Dijkstra/);

	await a.pulsar(a.boton("Próximos 7 días"));
	assert.equal(a.cabecera(), "14 nov – 20 nov");
	assert.deepEqual(a.pedidos.at(-1)!.seleccion, { desde: "2026-11-14", hasta: "2026-11-20" });
	assert.equal(a.boton("Próximos 7 días").getAttribute("aria-pressed"), "true");

	await a.pulsar(a.boton("Hoy"));
	assert.equal(a.cabecera(), "Sábado, 14 nov");
});

it("«Elegir rango» despliega el mes y fija el inicio y el fin, en cualquier orden", async () => {
	const a = await montar();
	await a.pulsar(a.boton("Elegir rango"));
	assert.equal(a.diasPintados().length, 42);
	a.boton("Elige el primer día…");
	await a.pulsar(a.dia("2026-11-25")!);
	a.boton("Elige el último día…");
	await a.pulsar(a.dia("2026-11-16")!);
	assert.equal(a.cabecera(), "16 nov – 25 nov");
	a.boton("Elegir rango");
	assert.equal(a.dia("2026-11-16")!.getAttribute("data-range-start"), "true");
	assert.equal(a.dia("2026-11-25")!.getAttribute("data-range-end"), "true");
});

it("pulsar un elemento lleva a su acción: repasar hoy, la unidad en otro día y la conversación", async () => {
	const a = await montar();
	await a.pulsar(a.boton(/Flujo/));
	await a.pulsar(a.boton("Próximos 7 días"));
	await a.pulsar(a.boton(/Cortes/));
	await a.pulsar(a.dia("2026-11-10")!);
	await a.pulsar(a.boton(/Dudas de Dijkstra/));
	assert.deepEqual(a.llamadas, ["repasar u1", "unidad u2", "conversacion c1"]);
});

it("el calendario no se rehace al pulsar: el botón de mes y el foco siguen ahí", async () => {
	const a = await montar();
	await a.pulsar(a.boton("Ver el mes"));
	const siguiente = a.doc.querySelector(".rdp-button_next")!;
	await a.pulsar(siguiente);
	assert.ok(siguiente.isConnected, "el mismo botón, no uno nuevo");
	const dia = a.dia("2026-12-09")!;
	await a.pulsar(dia);
	assert.ok(dia.isConnected);
	assert.equal(a.cabecera(), "Miércoles, 9 dic");
});

