/**
 * Conversaciones agrupables y filtrables en la barra lateral (ticket 03 de la segunda ronda): agrupar por fecha o
 * por unidad del plan (por plan con «Todos»), filtrar por actividad y por fecha, el icono de cada actividad y los
 * selectores recordados entre sesiones. La agrupación es una función pura; la barra, render estático.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SidebarProvider } from "../components/ui/sidebar.tsx";
import { BarraLateralEstudio, type DatosBarraLateral } from "../components/estudio/barra-lateral.tsx";
import {
	agruparConversaciones, FILTROS_INICIALES, filtrosConversaciones, recordarFiltros, type ConversacionLista, type FiltrosConversaciones,
} from "../components/estudio/conversaciones.ts";
import type { LecturaPlanes } from "../components/estudio/tipos.ts";

const AHORA = new Date("2026-11-12T18:00:00");
const nada = () => {};
const acciones = {
	elegirEspacio: nada, crearEspacio: nada, renombrarEspacio: nada, archivarEspacio: nada, recuperarEspacio: nada, traerSinEspacio: nada, crearPlan: nada,
	abrirAjustes: nada, navegar: nada, abrirPaleta: nada,
	renombrarConversacion: nada, exportarConversacion: nada, resumirConversacion: nada, borrarConversacion: nada, alternarSeccion: nada, abrirPorDecidir: nada,
	cambiarFiltros: nada,
};

const ciclo = { orientar: "hecho", exponer: "vacio", reconstruir: "vacio", mantener: "vacio" } as const;
const tema = (id: string, titulo: string) => ({ id: `e-${id}`, tipo: "tema" as const, titulo, hecho: false, fecha: null, unidad: { id, titulo, estado: "activa" as const, ciclo } });
const PLAN: LecturaPlanes = {
	planes: [{ id: "p1", revision: 1, objetivo: "Dominar grafos", estado: "activo", origen: "manual", hechos: 0, total: 2, cambios: [], elementos: [tema("u1", "Recorridos"), tema("u2", "Caminos mínimos")] }],
	sinPlan: [{ id: "u3", titulo: "Flujo máximo", propuesta: false, ciclo }],
};
const P1 = { id: "p1", objetivo: "Dominar grafos" };
const P2 = { id: "p2", objetivo: "Mecánica clásica" };

const conv = (id: string, updatedAt: string, origen: ConversacionLista["origen"], unidad: { id: string; titulo: string } | null = null, plan: { id: string; objetivo: string } | null = null): ConversacionLista =>
	({ id, title: `Conversación ${id}`, updatedAt, origen, unidad, plan });

const LISTA: ConversacionLista[] = [
	conv("hoy-libre", "2026-11-12T10:00:00", "libre"),
	conv("ayer-u2", "2026-11-11T10:00:00", "unidad", { id: "u2", titulo: "Caminos mínimos" }, P1),
	conv("semana-pasaje-u1", "2026-11-08T10:00:00", "pasaje", { id: "u1", titulo: "Recorridos" }, P1),
	conv("mes-intento-u1", "2026-10-20T10:00:00", "intento", { id: "u1", titulo: "Recorridos" }, P1),
	conv("viejo-fuera", "2026-09-01T10:00:00", "unidad", { id: "u3", titulo: "Flujo máximo" }, P1),
	conv("otra-unidad", "2026-11-05T10:00:00", "unidad", { id: "u9", titulo: "Unidad archivada" }, null),
	conv("pasaje-suelto", "2026-11-12T09:00:00", "pasaje"),
];

const filtros = (cambios: Partial<FiltrosConversaciones> = {}): FiltrosConversaciones => ({ ...FILTROS_INICIALES, ...cambios });
const resumen = (grupos: ReturnType<typeof agruparConversaciones>) => grupos.map(g => [g.etiqueta, g.numero, g.conversaciones.map(c => c.id)]);

describe("agruparConversaciones", () => {
	it("por defecto agrupa por fecha, con toda actividad y siempre", () => {
		assert.deepEqual(FILTROS_INICIALES, { agrupar: "fecha", actividad: "toda", fecha: "siempre" });
		assert.deepEqual(resumen(agruparConversaciones(LISTA, filtros(), { ahora: AHORA, planes: PLAN, todos: false })), [
			["Hoy", null, ["hoy-libre", "pasaje-suelto"]],
			["Ayer", null, ["ayer-u2"]],
			["Últimos 7 días", null, ["semana-pasaje-u1", "otra-unidad"]],
			["Antes", null, ["mes-intento-u1", "viejo-fuera"]],
		]);
	});

	it("por unidad sigue el orden de los planes; las de unidades sin plan después y «Sin unidad» al final", () => {
		assert.deepEqual(resumen(agruparConversaciones(LISTA, filtros({ agrupar: "unidad" }), { ahora: AHORA, planes: PLAN, todos: false })), [
			["Recorridos", null, ["semana-pasaje-u1", "mes-intento-u1"]],
			["Caminos mínimos", null, ["ayer-u2"]],
			["Flujo máximo", null, ["viejo-fuera"]],
			["Unidad archivada", null, ["otra-unidad"]],
			["Sin unidad", null, ["hoy-libre", "pasaje-suelto"]],
		]);
	});

	it("con «Todos», agrupa por plan, del más reciente al más antiguo, y «Sin plan» al final", () => {
		const todas = [...LISTA, conv("mecanica", "2026-11-12T12:00:00", "unidad", { id: "m1", titulo: "Newton" }, P2)];
		assert.deepEqual(resumen(agruparConversaciones(todas, filtros({ agrupar: "unidad" }), { ahora: AHORA, planes: null, todos: true })), [
			["Mecánica clásica", null, ["mecanica"]],
			["Dominar grafos", null, ["ayer-u2", "semana-pasaje-u1", "mes-intento-u1", "viejo-fuera"]],
			["Sin plan", null, ["hoy-libre", "pasaje-suelto", "otra-unidad"]],
		]);
	});

	it("los filtros de actividad y fecha se combinan", () => {
		const grupos = agruparConversaciones(LISTA, filtros({ actividad: "pasaje", fecha: "7" }), { ahora: AHORA, planes: PLAN, todos: false });
		assert.deepEqual(resumen(grupos), [["Hoy", null, ["pasaje-suelto"]], ["Últimos 7 días", null, ["semana-pasaje-u1"]]]);
		assert.deepEqual(resumen(agruparConversaciones(LISTA, filtros({ fecha: "30" }), { ahora: AHORA, planes: PLAN, todos: false })).flatMap(g => g[2]),
			["hoy-libre", "pasaje-suelto", "ayer-u2", "semana-pasaje-u1", "otra-unidad", "mes-intento-u1"]);
		assert.deepEqual(agruparConversaciones(LISTA, filtros({ actividad: "intento", fecha: "7" }), { ahora: AHORA, planes: PLAN, todos: false }), []);
	});
});

describe("filtros recordados entre sesiones", () => {
	const conAlmacen = <T,>(almacen: Map<string, string>, fn: () => T): T => {
		const previo = Object.getOwnPropertyDescriptor(globalThis, "window");
		Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: {
			getItem: (k: string) => almacen.get(k) ?? null, setItem: (k: string, v: string) => { almacen.set(k, v); },
		} } });
		try { return fn(); } finally { if (previo) Object.defineProperty(globalThis, "window", previo); else Reflect.deleteProperty(globalThis, "window"); }
	};

	it("sin nada guardado, los iniciales; lo guardado vuelve tal cual", () => {
		const almacen = new Map<string, string>();
		assert.deepEqual(conAlmacen(almacen, filtrosConversaciones), FILTROS_INICIALES);
		conAlmacen(almacen, () => recordarFiltros({ agrupar: "unidad", actividad: "intento", fecha: "30" }));
		assert.deepEqual(conAlmacen(almacen, filtrosConversaciones), { agrupar: "unidad", actividad: "intento", fecha: "30" });
	});

	it("un valor desconocido o un almacén roto vuelve a su valor inicial", () => {
		const almacen = new Map([["estudio:barra:conversaciones", JSON.stringify({ agrupar: "tema", actividad: "pasaje", fecha: 3 })]]);
		assert.deepEqual(conAlmacen(almacen, filtrosConversaciones), { agrupar: "fecha", actividad: "pasaje", fecha: "siempre" });
		almacen.set("estudio:barra:conversaciones", "{roto");
		assert.deepEqual(conAlmacen(almacen, filtrosConversaciones), FILTROS_INICIALES);
	});
});

function barra(datos: Partial<DatosBarraLateral> = {}) {
	return renderToStaticMarkup(
		<SidebarProvider open onOpenChange={nada}>
			<BarraLateralEstudio
				espacios={{ areas: [{ id: "a1", name: "Grafos", archived: false }], activeAreaId: "a1" }}
				conversaciones={LISTA}
				planes={PLAN}
				ruta="/"
				ahora={AHORA}
				acciones={acciones}
				{...datos}
			/>
		</SidebarProvider>,
	);
}

describe("BarraLateralEstudio: conversaciones agrupables y filtrables", () => {
	// Variante A (24-nov-2026): lupa y filtro en la cabecera; ni buscador fijo ni selectores nativos.
	it("en la cabecera de «Conversaciones», la lupa y el filtro; sin filtros, ni fichas ni punto", () => {
		const html = barra();
		assert.match(html, /data-testid="lupa-conversaciones"[^>]*>|aria-label="Buscar conversaciones"/);
		assert.match(html, /data-testid="filtro-conversaciones"/);
		assert.doesNotMatch(html, /<select/);
		assert.doesNotMatch(html, /data-testid="buscar-conversaciones"/, "el buscador solo sale al pulsar la lupa");
		assert.doesNotMatch(html, /data-filtros-activos/);
		assert.doesNotMatch(html, /data-testid="fichas-filtros"/);
		// Fuera de la sección plegable: la cabecera sigue a la vista con la sección plegada.
		const seccion = html.slice(html.indexOf('data-elementos="conversaciones"'));
		assert.ok(!seccion.includes('data-testid="filtro-conversaciones"'));
	});

	it("con filtros puestos, el punto en el filtro y una ficha por filtro que se quita con ✕", () => {
		const html = barra({ filtros: filtros({ actividad: "pasaje", fecha: "7" }) });
		assert.match(html, /data-testid="filtro-conversaciones"[^>]*data-filtros-activos="true"|data-filtros-activos="true"[^>]*data-testid="filtro-conversaciones"/);
		const fichas = [...html.matchAll(/data-ficha-filtro="([^"]+)"[^>]*>([^<]*)</g)].map(m => [m[1], m[2]]);
		assert.deepEqual(fichas, [["actividad", "Pasaje"], ["fecha", "7 días"]]);
		assert.match(html, /aria-label="Quitar el filtro Pasaje"/);
	});

	it("agrupar no cuenta como filtro", () => {
		const html = barra({ filtros: filtros({ agrupar: "unidad" }) });
		assert.doesNotMatch(html, /data-filtros-activos/);
		assert.doesNotMatch(html, /data-testid="fichas-filtros"/);
	});

	it("con «Todos», agrupar por plan", () => {
		const html = barra({ espacios: { areas: [{ id: "a1", name: "Grafos", archived: false }], activeAreaId: null }, filtros: filtros({ agrupar: "unidad" }) });
		assert.match(html, /Dominar grafos/);
		assert.match(html, /Sin plan/);
	});

	it("por unidad, los grupos siguen el orden de los planes, sin número, y «Sin unidad» va al final", () => {
		const html = barra({ filtros: filtros({ agrupar: "unidad" }) });
		const cabeceras = [...html.matchAll(/data-grupo-conversaciones="[^"]*"[^>]*>([\s\S]*?)<\/p>/g)].map(m => m[1]!.replace(/<[^>]+>/g, ""));
		assert.deepEqual(cabeceras, ["Recorridos", "Caminos mínimos", "Flujo máximo", "Unidad archivada", "Sin unidad"]);
	});

	it("cada fila lleva el icono y el nombre de su actividad", () => {
		const html = barra();
		const fila = (id: string) => html.match(new RegExp(`<button[^>]*data-testid="conversacion"[^>]*data-conversacion="${id}"[\\s\\S]*?</button>`))?.[0] ?? "";
		assert.match(fila("hoy-libre"), /data-actividad="libre"/);
		assert.match(fila("hoy-libre"), /<span class="sr-only">Libre: <\/span>/);
		assert.match(fila("ayer-u2"), /data-actividad="unidad"/);
		assert.match(fila("ayer-u2"), /title="Estudio de unidad · Caminos mínimos"/);
		assert.match(fila("semana-pasaje-u1"), /data-actividad="pasaje"/);
		assert.match(fila("mes-intento-u1"), /data-actividad="intento"/);
	});

	it("sin resultados con los filtros lo dice y deja el filtro y las fichas para cambiarlos", () => {
		const html = barra({ filtros: filtros({ actividad: "intento", fecha: "7" }) });
		assert.match(html, /Ninguna conversación con estos filtros\./);
		assert.match(html, /data-testid="filtro-conversaciones"/);
		assert.match(html, /data-testid="fichas-filtros"/);
		assert.doesNotMatch(html, /data-testid="conversacion"/);
	});

	it("sin ninguna conversación en el espacio, ni lupa ni filtro", () => {
		const html = barra({ conversaciones: [] });
		assert.match(html, /Aún no hay conversaciones en este espacio/);
		assert.doesNotMatch(html, /data-testid="(lupa|filtro)-conversaciones"/);
	});

	it("en ambas agrupaciones, cada fila conserva su menú de acciones", () => {
		for (const agrupar of ["fecha", "unidad"] as const) {
			const html = barra({ filtros: filtros({ agrupar }) });
			assert.equal(html.match(/data-testid="conversacion-mas"/g)?.length, LISTA.length, agrupar);
		}
	});
});
