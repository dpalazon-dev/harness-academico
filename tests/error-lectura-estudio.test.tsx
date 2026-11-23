/**
 * Lecturas que fallan en Agenda, Por decidir y Biblioteca: en lugar de un «Cargando…» para siempre, «No se pudo leer …»
 * con «Reintentar». Pintado en estático y, para la agenda (lectura, fallo y reintento), montado sobre linkedom.
 */
import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { AgendaInicio, useDatosAgenda, type AccionesAgenda } from "../components/estudio/agenda.tsx";
import { ListaPorDecidir } from "../components/estudio/por-decidir.tsx";
import { BibliotecaEstudio } from "../components/estudio/biblioteca.tsx";
import { ErrorDeLectura } from "../components/estudio/error-lectura.tsx";
import type { LecturaPorDecidir } from "../components/estudio/tipos.ts";

const nada = () => {};
const AHORA = new Date("2026-11-14T10:00:00");
const accionesAgenda: AccionesAgenda = { repasar: nada, paso: nada, abrirUnidad: nada, abrirConversacion: nada };
const accionesPorDecidir = { abrirUnidad: nada, confirmarUnidad: nada, descartarUnidad: nada, aplicarCambio: nada, rechazarCambio: nada, confirmarBorrador: nada, descartarBorrador: nada };
const accionesBiblioteca = { subir: nada, incorporarRuta: nada, leer: nada, detalle: nada, vincular: nada, registrarEnBase: nada, reintentar: nada, borrar: nada };
const VACIA: LecturaPorDecidir = { unidades: [], cambios: [], borradores: [] };

const agenda = (props: Partial<React.ComponentProps<typeof AgendaInicio>> = {}) =>
	renderToStaticMarkup(<AgendaInicio datos={null} ahora={AHORA} ocupado={false} acciones={accionesAgenda} onRangos={nada} {...props} />);
const porDecidir = (props: Partial<React.ComponentProps<typeof ListaPorDecidir>> = {}) =>
	renderToStaticMarkup(<ListaPorDecidir lectura={null} ocupado={false} error={null} acciones={accionesPorDecidir} {...props} />);
const biblioteca = (props: Partial<React.ComponentProps<typeof BibliotecaEstudio>> = {}) =>
	renderToStaticMarkup(<BibliotecaEstudio documentos={null} subiendo={null} detalle={null} unidades={[]} ocupado={false} error={null} acciones={accionesBiblioteca} {...props} />);

const REINTENTAR = /<p role="alert" data-error-lectura[^>]*>No se pudo leer ([^<]*)\.(?:<!-- -->)? <button[^>]*data-reintentar[^>]*>Reintentar<\/button><\/p>/;

describe("ErrorDeLectura", () => {
	it("dice qué no se pudo leer y, si se puede, ofrece reintentar", () => {
		assert.match(renderToStaticMarkup(<ErrorDeLectura que="la agenda" reintentar={nada} />), REINTENTAR);
		const sin = renderToStaticMarkup(<ErrorDeLectura que="la agenda" />);
		assert.match(sin, /No se pudo leer la agenda\./);
		assert.doesNotMatch(sin, /Reintentar/);
	});
});

describe("estados de lectura, pintados", () => {
	it("agenda: leyendo, sin error; con la lectura caída, el error en lugar de «Leyendo la agenda…»", () => {
		assert.match(agenda(), /Leyendo la agenda…/);
		assert.match(agenda(), /data-agenda="lista" aria-busy="true"/);
		const html = agenda({ error: "Estudio no respondió (500)", reintentar: nada });
		assert.doesNotMatch(html, /Leyendo la agenda…/);
		assert.match(html, /data-agenda="lista" aria-busy="false"/);
		assert.equal(html.match(REINTENTAR)?.[1], "la agenda");
	});

	it("agenda: con datos de antes, la lista se queda y el error va encima", () => {
		const html = agenda({ datos: { hoy: "2026-11-14", dias: {} }, error: "x", reintentar: nada });
		assert.match(html, REINTENTAR);
		assert.match(html, /Nada pendiente para hoy\./);
	});

	it("por decidir: «Cargando…» solo mientras no hay fallo; con la lectura caída, el error y «Reintentar»", () => {
		assert.match(porDecidir(), /Cargando…/);
		const html = porDecidir({ errorLectura: true, reintentar: nada });
		assert.doesNotMatch(html, /Cargando…/);
		assert.equal(html.match(REINTENTAR)?.[1], "lo pendiente de decidir");
		assert.match(porDecidir({ lectura: VACIA, errorLectura: true, reintentar: nada }), /Reintentar[\s\S]*Nada pendiente de tu decisión\./, "la lectura anterior sigue debajo");
	});

	it("biblioteca: «Cargando…» solo mientras no hay fallo; con la lectura caída, el error y «Reintentar»", () => {
		assert.match(biblioteca(), /Cargando…/);
		const html = biblioteca({ errorLectura: true, releer: nada });
		assert.doesNotMatch(html, /Cargando…/);
		assert.equal(html.match(REINTENTAR)?.[1], "la Biblioteca");
		assert.match(biblioteca({ documentos: [], errorLectura: true, releer: nada }), /Reintentar[\s\S]*Todavía no hay documentos/);
	});
});

let root: Root | null = null;
let restore: (() => void) | null = null;

afterEach(async () => {
	await act(async () => { root?.unmount(); });
	root = null;
	restore?.();
	restore = null;
});

describe("useDatosAgenda, montado", () => {
	it("si la lectura falla lo dice; «Reintentar» vuelve a leer y, si sale bien, pinta la lista", async () => {
		const dom = parseHTML("<html><head></head><body><div id='root'></div></body></html>");
		let falla = true;
		const pedidas: string[] = [];
		const globals: Record<string, unknown> = {
			window: dom.window, document: dom.document, HTMLElement: dom.window.HTMLElement, Element: dom.window.Element, Node: dom.window.Node,
			SVGElement: dom.window.SVGElement, IS_REACT_ACT_ENVIRONMENT: true,
			fetch: async (_url: string, init: { body: string }) => {
				pedidas.push(JSON.parse(init.body).operation);
				if (falla) return new Response(JSON.stringify({ error: "caído" }), { status: 500 });
				return new Response(JSON.stringify({ result: { hoy: "2026-11-14", dias: [] } }), { status: 200 });
			},
		};
		const saved = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
		Object.assign(globalThis, globals);
		restore = () => { for (const [key, d] of saved) { if (d) Object.defineProperty(globalThis, key, d); else Reflect.deleteProperty(globalThis, key); } };

		function Conectada() {
			const a = useDatosAgenda();
			return <AgendaInicio datos={a.datos} error={a.error} reintentar={a.refrescar} ahora={AHORA} ocupado={false} acciones={accionesAgenda} onRangos={a.onRangos} />;
		}
		root = createRoot(dom.document.querySelector("#root")!);
		await act(async () => { root!.render(<Conectada />); });
		await act(async () => { await new Promise(r => setTimeout(r, 0)); });
		const q = (sel: string) => dom.document.querySelector(sel);
		assert.ok(q("[data-error-lectura]"), "el fallo se ve");
		assert.doesNotMatch(q("[data-agenda='lista']")!.textContent ?? "", /Leyendo la agenda/);

		falla = false;
		const antes = pedidas.length;
		await act(async () => { q("[data-reintentar]")!.dispatchEvent(new dom.window.Event("click", { bubbles: true })); });
		await act(async () => { await new Promise(r => setTimeout(r, 0)); });
		assert.ok(pedidas.length > antes, "vuelve a pedir la agenda");
		assert.equal(q("[data-error-lectura]"), null, "el error se va");
		assert.match(q("[data-agenda='lista']")!.textContent ?? "", /Nada pendiente para hoy\./);
	});
});
