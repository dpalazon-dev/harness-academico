/**
 * Ritmo de estudio pintado (ticket 06 de la segunda ronda): la línea de cifras
 * del inicio y el gráfico anual de actividad de Progreso, con la lectura
 * `ritmo` del plugin dentro y marcado fuera. Render estático de las piezas puras.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { GraficoActividad, LineaRitmo } from "../components/estudio/ritmo.tsx";
import type { LecturaRitmo } from "../components/estudio/tipos.ts";

/** 365 días que acaban el domingo 15 de noviembre de 2026, con actividad donde diga `n`. */
function actividad(n: Record<string, number> = {}): LecturaRitmo["actividad"] {
	const fin = Date.UTC(2026, 10, 15);
	return Array.from({ length: 365 }, (_, i) => {
		const dia = new Date(fin - (364 - i) * 86_400_000).toISOString().slice(0, 10);
		return { dia, n: n[dia] ?? 0 };
	});
}

const RITMO: LecturaRitmo = {
	hoy: "2026-11-15", diasEstudiados: 12, racha: 3, repasos: { total: 5, aTiempo: 4 },
	intentosPorSemana: [1, 3, 2, 5], tendencia: "sube", actividad: actividad(),
};
const CERO: LecturaRitmo = {
	hoy: "2026-11-15", diasEstudiados: 0, racha: 0, repasos: { total: 0, aTiempo: 0 },
	intentosPorSemana: [0, 0, 0, 0], tendencia: "igual", actividad: actividad(),
};
const texto = (html: string) => html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");

describe("LineaRitmo", () => {
	it("muestra las cuatro cifras: días en 4 semanas, racha, repasos a tiempo e intentos de los últimos 7 días con su tendencia", () => {
		const html = renderToStaticMarkup(<LineaRitmo ritmo={RITMO} />);
		const t = texto(html);
		assert.match(t, /12 días en 4 semanas/);
		assert.match(t, /3 días de racha/);
		assert.match(t, /80 % repasos a tiempo/);
		assert.match(t, /5 intentos en 7 días/);
		assert.match(html, /data-tendencia="sube"/);
		assert.match(html, /4 de 5 repasos/, "el detalle de los repasos, al pasar el ratón");
		assert.match(html, /1 · 3 · 2 · 5/, "los intentos de cada semana, al pasar el ratón");
	});

	it("en singular cuando toca", () => {
		const t = texto(renderToStaticMarkup(<LineaRitmo ritmo={{ ...RITMO, diasEstudiados: 1, racha: 1, intentosPorSemana: [0, 0, 0, 1] }} />));
		assert.match(t, /1 día en 4 semanas/);
		assert.match(t, /1 día de racha/);
		assert.match(t, /1 intento en 7 días/);
	});

	it("sin actividad, ceros y sin porcentajes imposibles", () => {
		const html = renderToStaticMarkup(<LineaRitmo ritmo={CERO} />);
		const t = texto(html);
		for (const c of [/0 días en 4 semanas/, /0 días de racha/, /0 repasos/, /0 intentos en 7 días/]) assert.match(t, c);
		assert.doesNotMatch(t, /NaN|%/);
		assert.match(html, /data-tendencia="igual"/);
	});

	it("mientras carga no pinta cifras, pero guarda su sitio", () => {
		const html = renderToStaticMarkup(<LineaRitmo ritmo={null} />);
		assert.match(html, /data-ritmo/);
		assert.doesNotMatch(texto(html), /\d/);
	});
});

describe("GraficoActividad", () => {
	const celdas = (html: string) => [...html.matchAll(/data-dia="(\d{4}-\d{2}-\d{2})"[^>]*data-nivel="(\d)"/g)].map(m => [m[1], Number(m[2])] as const);

	it("una celda por día del año, en columnas de semana de lunes a domingo, hasta hoy", () => {
		const html = renderToStaticMarkup(<GraficoActividad actividad={actividad()} />);
		const c = celdas(html);
		assert.equal(c.length, 365);
		assert.equal(c.at(-1)![0], "2026-11-15");
		// El primer día, domingo 16 de noviembre de 2025, cierra la primera columna (seis huecos delante); detrás, 52 semanas.
		assert.equal(c[0]![0], "2025-11-16");
		assert.equal([...html.matchAll(/data-semana=/g)].length, 53);
		assert.equal([...html.matchAll(/data-hueco/g)].length, 6);
	});

	it("tres intensidades según lo hecho, con los colores del tema", () => {
		const html = renderToStaticMarkup(<GraficoActividad actividad={actividad({ "2026-11-10": 1, "2026-11-11": 2, "2026-11-12": 7 })} />);
		const nivel = new Map(celdas(html));
		assert.deepEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12"].map(d => nivel.get(d)), [0, 1, 2, 3]);
		assert.match(html, /var\(--lh-success\)/);
		assert.doesNotMatch(html, /#[0-9a-f]{3,6}\b|rgb\(/i, "ningún color fijo: todo sale del tema");
		assert.match(html, /title="12 nov: 7 actividades"/);
	});

	it("resume el año, rotula los meses y lleva leyenda de menos a más", () => {
		const html = renderToStaticMarkup(<GraficoActividad actividad={actividad({ "2026-11-10": 1, "2026-11-12": 7, "2026-03-02": 2 })} />);
		const t = texto(html);
		assert.match(t, /3 días estudiados en el último año/);
		for (const m of ["dic", "ene", "jun", "nov"]) assert.match(t, new RegExp(m));
		assert.match(t, /menos.*más/);
		assert.match(html, /role="img"/);
	});

	it("sin actividad lo dice, y la rejilla sigue en su sitio", () => {
		const html = renderToStaticMarkup(<GraficoActividad actividad={actividad()} />);
		assert.match(texto(html), /Ningún día estudiado en el último año/);
		assert.equal(celdas(html).length, 365);
	});
});
