/**
 * La agenda del inicio pintada (ticket 05 de la segunda ronda): calendario de
 * shadcn con la semana actual o el mes, días pasados en tres intensidades de
 * verde, punto en los días con repasos, contorno en hoy y leyenda gráfica; y
 * debajo la lista de la selección (hoy, un día pasado, un día futuro, un rango).
 * Render estático de la pieza pura, como el resto de `render-*-estudio`.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgendaInicio, type AccionesAgenda, type EstadoAgenda } from "../components/estudio/agenda.tsx";
import type { DiaAgenda } from "../components/estudio/tipos.ts";

// Sábado 14 de noviembre de 2026; su semana va del lunes 9 al domingo 15.
const AHORA = new Date("2026-11-14T10:00:00");
const nada = () => {};
const acciones: AccionesAgenda = { repasar: nada, paso: nada, abrirUnidad: nada, abrirConversacion: nada };

const paso = (tipo: "volcado" | "reconstruir" | "tutor", unitId: string, titulo: string) => ({
	tipo: "paso" as const, unitId, titulo,
	paso: { tipo, accion: tipo === "volcado" ? "Escribe lo que ya sabes" : tipo === "reconstruir" ? "Reconstruye sin mirar" : "Estudia con el tutor", motivo: "Porque sí.", boton: "Ir", unitId, titulo },
});
const repaso = (unitId: string, titulo: string, fecha: string | null, vencidoDias = 0, intentoId: string | null = null) =>
	({ tipo: "repaso" as const, unitId, titulo, tarea: "libre" as const, intentoId, fecha, vencidoDias });

const DIAS: DiaAgenda[] = [
	{ dia: "2026-11-02", pendientes: [], hecho: [{ tipo: "intento", unitId: "u1", titulo: "Flujo", tarea: "libre", intentoId: "i0" }] },
	{ dia: "2026-11-10", pendientes: [], hecho: [
		{ tipo: "intento", unitId: "u1", titulo: "Flujo", tarea: "aplicada", intentoId: "i1" },
		{ tipo: "volcado", unitId: "u2", titulo: "Cortes" },
		{ tipo: "conversacion", chatId: "c1", titulo: "Dudas sobre Dijkstra", unitId: null },
		{ tipo: "cierre-bloque", unitId: "u1", titulo: "Flujo" },
	] },
	{ dia: "2026-11-12", pendientes: [], hecho: [{ tipo: "fuente-trabajada", unitId: "u2", titulo: "Cortes" }, { tipo: "intento", unitId: "u2", titulo: "Cortes", tarea: "libre", intentoId: "i2" }] },
	{ dia: "2026-11-14", hecho: [], pendientes: [
		repaso("u3", "Emparejamientos", null, 0, "i3"),
		repaso("u1", "Flujo", "2026-11-11", 3),
		repaso("u4", "Coloreado", "2026-11-14"),
		paso("volcado", "u5", "Árboles"),
		paso("reconstruir", "u2", "Cortes"),
	] },
	{ dia: "2026-11-16", hecho: [], pendientes: [repaso("u2", "Cortes", "2026-11-16")] },
	{ dia: "2026-11-19", hecho: [], pendientes: [repaso("u6", "Planaridad", "2026-11-19"), repaso("u7", "Recorridos", "2026-11-19")] },
	{ dia: "2026-11-27", hecho: [], pendientes: [repaso("u6", "Planaridad", "2026-11-27")] },
];
const datos = { hoy: "2026-11-14", dias: Object.fromEntries(DIAS.map(d => [d.dia, d])) };

function agenda(inicial?: Partial<EstadoAgenda>) {
	return renderToStaticMarkup(<AgendaInicio datos={datos} ahora={AHORA} ocupado={false} acciones={acciones} inicial={inicial} onRangos={nada} />);
}
const diasPintados = (html: string) => [...html.matchAll(/data-dia="(\d{4}-\d{2}-\d{2})"/g)].map(m => m[1]);
/** Un atributo del botón de un día del calendario, o null si no lo lleva. */
function atributoDe(html: string, dia: string, atributo: string): string | null {
	const boton = new RegExp(`<button[^>]*data-dia="${dia}"[^>]*>`).exec(html)?.[0] ?? "";
	return new RegExp(` ${atributo}="([^"]*)"`).exec(boton)?.[1] ?? null;
}
const lista = (html: string) => html.slice(html.indexOf('data-agenda="lista"'));

describe("agenda del inicio", () => {
	it("abre en la semana actual, con hoy seleccionado, y lista lo pendiente de hoy", () => {
		const html = agenda();
		assert.deepEqual(diasPintados(html), ["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"]);
		assert.equal(atributoDe(html, "2026-11-14", "data-range-start"), "true", "hoy, seleccionado");
		assert.match(html, />Ver el mes</);
		assert.doesNotMatch(html, /Ver solo esta semana/);
		const l = lista(html);
		assert.match(l, /Sábado, 14 nov/);
		assert.match(l, /5 pendientes/);
		for (const t of ["Emparejamientos", "Flujo", "Coloreado", "Árboles", "Cortes"]) assert.match(l, new RegExp(t));
	});

	it("pinta los días pasados en tres intensidades de verde, un punto en los días con repasos y un contorno en hoy", () => {
		const html = agenda();
		assert.equal(atributoDe(html, "2026-11-10", "data-actividad"), "3", "cuatro cosas hechas: el máximo");
		assert.equal(atributoDe(html, "2026-11-12", "data-actividad"), "2");
		assert.equal(atributoDe(html, "2026-11-11", "data-actividad"), null, "sin actividad, sin verde");
		assert.equal(atributoDe(html, "2026-11-14", "data-hoy"), "true");
		assert.equal(atributoDe(html, "2026-11-14", "data-repaso"), "true", "hoy tiene repasos");
		assert.equal(atributoDe(html, "2026-11-13", "data-hoy"), null);
		assert.match(html, /color-mix\(in_oklab,var\(--lh-success\)/, "el verde sale del tema");
		const mes = agenda({ vista: "mes" });
		assert.equal(atributoDe(mes, "2026-11-02", "data-actividad"), "1");
		assert.equal(atributoDe(mes, "2026-11-19", "data-repaso"), "true");
		assert.equal(atributoDe(mes, "2026-11-20", "data-repaso"), null);
	});

	it("la leyenda es gráfica: escala de actividad, punto de repaso y recuadro de hoy", () => {
		const ley = /data-agenda="leyenda">([\s\S]*?)<\/div>/.exec(agenda())![1]!;
		assert.equal([...ley.matchAll(/data-nivel="\d"/g)].length, 3);
		const texto = ley.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
		assert.equal(texto, "menos más repaso hoy");
	});

	it("desplegada, enseña el mes entero con su navegación y la opción de replegar", () => {
		const html = agenda({ vista: "mes" });
		const d = diasPintados(html);
		assert.deepEqual([d[0], d.at(-1), d.length], ["2026-10-26", "2026-12-06", 42]);
		assert.match(html, /Ver solo esta semana/);
		assert.match(html, /aria-label="[^"]*(mes|month)[^"]*"/i, "botones de mes anterior y siguiente");
		assert.match(html, />noviembre 2026</);
	});

	it("cada elemento lleva su tipo de actividad con icono y color, la unidad y qué hacer en lenguaje llano; los vencidos dicen cuánto", () => {
		const l = lista(agenda());
		const tipos = [...l.matchAll(/data-actividad-tipo="(\w+)"/g)].map(m => m[1]);
		assert.deepEqual(tipos, ["repaso", "repaso", "repaso", "volcado", "reconstruir"]);
		assert.match(l, /retomar el intento a medias/);
		assert.match(l, /recuperar sin mirar<span class="text-\[var\(--lh-accent\)\]"> · vencido hace 3 d</);
		assert.match(l, /escribe lo que ya sabes/);
		assert.equal((l.match(/vencido hace/g) ?? []).length, 1);
		assert.equal((l.match(/<svg/g) ?? []).length, 5, "un icono por elemento");
		assert.doesNotMatch(l, /Repasar · /, "ya no «Repasar · unidad»");
	});

	it("un día pasado lista lo hecho, o dice que no estudiaste", () => {
		const l = lista(agenda({ seleccion: { desde: "2026-11-10", hasta: "2026-11-10" } }));
		assert.match(l, /Martes, 10 nov/);
		assert.match(l, /4 cosas hechas/);
		assert.deepEqual([...l.matchAll(/data-actividad-tipo="(\w+)"/g)].map(m => m[1]), ["repaso", "volcado", "estudiar", "reconstruir"]);
		assert.match(l, /Dudas sobre Dijkstra/);
		assert.match(l, /hiciste un intento: aplicar a un caso/);
		const vacio = lista(agenda({ seleccion: { desde: "2026-11-11", hasta: "2026-11-11" } }));
		assert.match(vacio, /No estudiaste este día\./);
	});

	it("un día futuro lista sus repasos, o que no hay nada planificado", () => {
		const l = lista(agenda({ seleccion: { desde: "2026-11-19", hasta: "2026-11-19" } }));
		assert.match(l, /2 repasos · 2 unidades/);
		assert.match(l, /Planaridad[\s\S]*Recorridos/);
		assert.match(lista(agenda({ seleccion: { desde: "2026-11-18", hasta: "2026-11-18" } })), /Nada planificado en estas fechas\./);
	});

	it("los próximos 7 días agrupan los repasos por día, con hoy en acento y sin sus pasos", () => {
		const html = agenda({ seleccion: { desde: "2026-11-14", hasta: "2026-11-20" } });
		assert.match(html, /aria-pressed="true"[^>]*>Próximos 7 días</);
		const l = lista(html);
		assert.match(l, /14 nov – 20 nov/);
		assert.match(l, /6 repasos · 6 unidades/, "el intento a medias de hoy cuenta como repaso");
		assert.deepEqual([...l.matchAll(/data-dia-lista="([\d-]+)"/g)].map(m => m[1]), ["2026-11-14", "2026-11-16", "2026-11-19"]);
		assert.doesNotMatch(l, /Árboles/, "los pasos propuestos solo en «Hoy»");
		assert.match(l, />hoy</);
		const vacio = lista(agenda({ seleccion: { desde: "2026-11-21", hasta: "2026-11-26" } }));
		assert.match(vacio, /Nada planificado en estas fechas\./);
	});

	it("un rango elegido a mano marca inicio y fin y lista cada día con lo suyo", () => {
		const html = agenda({ vista: "mes", seleccion: { desde: "2026-11-10", hasta: "2026-11-19" } });
		assert.equal(atributoDe(html, "2026-11-10", "data-range-start"), "true");
		assert.equal(atributoDe(html, "2026-11-19", "data-range-end"), "true");
		assert.equal(atributoDe(html, "2026-11-15", "data-range-middle"), "true");
		const l = lista(html);
		assert.deepEqual([...l.matchAll(/data-dia-lista="([\d-]+)"/g)].map(m => m[1]), ["2026-11-10", "2026-11-12", "2026-11-14", "2026-11-16", "2026-11-19"]);
		assert.match(agenda({ vista: "mes", eligiendo: "fin" }), /Elige el último día…/);
	});

	it("el resumen cuenta unidades distintas aunque compartan título, y la etiqueta del día dice si está seleccionado", () => {
		const gemelas: DiaAgenda = { dia: "2026-11-17", hecho: [], pendientes: [repaso("x1", "Repaso general", "2026-11-17"), repaso("x2", "Repaso general", "2026-11-17")] };
		const html = renderToStaticMarkup(<AgendaInicio datos={{ hoy: "2026-11-14", dias: { [gemelas.dia]: gemelas } }} ahora={AHORA} ocupado={false} acciones={acciones} inicial={{ vista: "mes", seleccion: { desde: "2026-11-17", hasta: "2026-11-17" } }} onRangos={nada} />);
		assert.match(lista(html), /2 repasos · 2 unidades/);
		assert.equal(atributoDe(html, "2026-11-17", "aria-label"), "martes, 17 de noviembre de 2026, seleccionado, con repasos");
	});
});
