/**
 * Progreso del armazón de estudio (ticket 10), pintado en estático: la lectura
 * `progreso` del plugin dentro, marcado fuera. Etapas, calibración con el
 * Brier explicado, tipos de fallo y actividad, sin historial por unidad y sin
 * decir nunca que algo esté «aprendido» o «dominado».
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProgresoEstudio, veredictoCalibracion } from "../components/estudio/progreso.tsx";
import type { LecturaProgreso } from "../components/estudio/tipos.ts";

/** Un año de actividad que acaba el 15 de noviembre de 2026, con algo hecho donde diga `n`. */
function actividad(n: Record<string, number> = {}) {
	const fin = Date.UTC(2026, 10, 15);
	return Array.from({ length: 365 }, (_, i) => {
		const dia = new Date(fin - (364 - i) * 86_400_000).toISOString().slice(0, 10);
		return { dia, n: n[dia] ?? 0 };
	});
}

const PROGRESO: LecturaProgreso = {
	units: [
		{ unitId: "u1", title: "Caminos mínimos", stage: { kind: "intervalo", label: "Recuperada · intervalo de 7 días", days: 7 }, needsVerification: false },
		{ unitId: "u2", title: "Árboles de expansión", stage: { kind: "intervalo", label: "Recuperada · intervalo de 2 días", days: 2 }, needsVerification: true },
		{ unitId: "u3", title: "Flujo máximo", stage: { kind: "nueva", label: "Sin practicar", days: null }, needsVerification: false },
		{ unitId: "u4", title: "Planaridad", stage: { kind: "reaprendiendo", label: "Reaprendiendo", days: null }, needsVerification: false },
	],
	calibration: { attempts: 5, brier: 0.184, meanConfidence: 0.72, successRate: 0.4 },
	failures: { precision: 3, acceso: 1 },
};

const pintar = (props: Partial<React.ComponentProps<typeof ProgresoEstudio>> = {}) =>
	renderToStaticMarkup(<ProgresoEstudio progreso={PROGRESO} actividad={actividad({ "2026-11-03": 1, "2026-11-12": 3 })} error={null} abrirUnidad={() => {}} {...props} />);

describe("ProgresoEstudio", () => {
	it("muestra etapas, calibración, fallos y el año de actividad en lugar de los últimos 14 días", () => {
		const html = pintar();
		for (const t of ["Unidades por etapa", "Calibración", "Tipos de fallo", "Actividad del año"]) assert.match(html, new RegExp(t));
		assert.doesNotMatch(html, /Últimos 14 días/);
		assert.ok(html.indexOf("Tipos de fallo") < html.indexOf("Actividad del año"), "el año va al final, donde estaban los 14 días");
	});

	it("agrupa las unidades por etapa, de menos a más evidencia, y cada una lleva a su página", () => {
		const html = pintar();
		const orden = ["nueva", "reaprendiendo", "intervalo"].map(k => html.indexOf(`data-etapa="${k}"`));
		assert.ok(orden.every(i => i >= 0) && orden[0]! < orden[1]! && orden[1]! < orden[2]!, String(orden));
		assert.doesNotMatch(html, /data-etapa="mantenimiento"/);
		assert.match(html, /Recuperadas con intervalo<\/span><span[^>]*>2</);
		assert.match(html, /href="\/unidad\/u1"/);
		assert.match(html, /Árboles de expansión<span[^>]*>· pendiente de verificar/);
	});

	it("no repite el historial de cada unidad", () => {
		const html = pintar();
		assert.doesNotMatch(html, /Historial/);
		assert.doesNotMatch(html, /<table/);
	});

	it("primero el veredicto; el Brier, con su escala, plegado en «Cómo se calcula»", () => {
		const html = pintar();
		assert.ok(html.indexOf("Confías más de lo que recuperas sin ayuda") < html.indexOf("<details"), "el veredicto va antes que el cálculo");
		assert.match(html, /<details[^>]*data-calculo-calibracion[^>]*><summary[^>]*>Cómo se calcula<\/summary>[\s\S]*Brier 0,18[\s\S]*<\/details>/);
		assert.doesNotMatch(html, /<details[^>]*open/, "plegado"); 
		assert.match(html, /Brier 0,18/);
		assert.match(html, /5 intentos que cuentan como evidencia/);
		assert.match(html, /\(confianza − resultado\)²/);
		assert.match(html, /0 es una calibración perfecta; 0,25/);
		assert.match(html, /Confías más de lo que recuperas sin ayuda/);
		assert.match(html, /72 %/);
		assert.match(html, /40 %/);
	});

	it("el veredicto de calibración tiene diez puntos de margen", () => {
		const c = { attempts: 1, brier: 0, meanConfidence: 0.5, successRate: 0.55 };
		assert.equal(veredictoCalibracion(c), "Tu confianza se ajusta a lo que recuperas.");
		assert.equal(veredictoCalibracion({ ...c, successRate: 0.8 }), "Recuperas más de lo que crees.");
	});

	it("ordena los fallos de más a menos y explica cada tipo", () => {
		const html = pintar();
		assert.ok(html.indexOf('data-fallo="precision"') < html.indexOf('data-fallo="acceso"'));
		assert.match(html, /lo recuperas con errores/);
		assert.doesNotMatch(html, /data-fallo="transferencia"/);
	});

	it("el gráfico anual cuenta los días estudiados y los describe para lectores de pantalla", () => {
		const html = pintar();
		assert.match(html, /data-grafico="actividad"/);
		assert.match(html, /role="img" aria-label="2 días estudiados en el último año\."/);
		assert.equal([...html.matchAll(/data-dia="/g)].length, 365);
	});

	it("el año de actividad se lee aparte: mientras carga o si falla, el resto de Progreso no espera", () => {
		const cargando = pintar({ actividad: "cargando" });
		assert.match(cargando, /Unidades por etapa/);
		assert.match(cargando, /Actividad del año[\s\S]*Cargando…/);
		assert.doesNotMatch(cargando, /data-grafico/);
		const fallo = pintar({ actividad: "fallo" });
		assert.match(fallo, /Tipos de fallo/);
		assert.match(fallo, /Actividad del año[\s\S]*No se pudo leer la actividad/);
		assert.doesNotMatch(fallo, /role="alert"/, "no es un error de la página");
	});

	it("sin datos, cada sección dice qué falta", () => {
		const html = pintar({ progreso: { units: [], calibration: null, failures: {} }, actividad: actividad() });
		assert.match(html, /Aún no hay unidades activas en este espacio/);
		assert.match(html, /Aparece cuando haya intentos que cuenten como evidencia/);
		assert.match(html, /Sin fallos registrados/);
		assert.match(html, /Ningún día estudiado en el último año/);
	});

	it("mientras carga y con error", () => {
		assert.match(pintar({ progreso: null }), /Cargando…/);
		const html = pintar({ progreso: null, error: "Estudio no respondió (500)" });
		assert.match(html, /role="alert"[^>]*>Estudio no respondió/);
		assert.doesNotMatch(html, /Cargando/);
	});

	it("sin jerga del diseño: ni «regulador» ni dobles negaciones; el atajo, como en Windows", () => {
		const todas: LecturaProgreso = {
			...PROGRESO,
			units: (["nueva", "practicada", "reaprendiendo", "intervalo", "mantenimiento", "fuera"] as const)
				.map((kind, i) => ({ unitId: `u${i}`, title: `Unidad ${i}`, stage: { kind, label: kind, days: null }, needsVerification: false })),
		};
		const html = pintar({ progreso: todas });
		assert.doesNotMatch(html, /regulador/i);
		assert.match(html, /Has practicado, pero aún ningún intento cuenta como evidencia\./);
		const vacio = pintar({ progreso: { units: [], calibration: null, failures: {} } });
		assert.match(vacio, /crea otra con (<!-- -->)?Ctrl\+K/);
		assert.doesNotMatch(vacio, /⌘K/);
	});

	it("nunca dice «aprendido» ni «dominado»", () => {
		const todas: LecturaProgreso = {
			...PROGRESO,
			units: (["nueva", "practicada", "reaprendiendo", "intervalo", "mantenimiento", "fuera"] as const)
				.map((kind, i) => ({ unitId: `u${i}`, title: `Unidad ${i}`, stage: { kind, label: kind, days: null }, needsVerification: false })),
			failures: { acceso: 1, precision: 1, estructural: 1, discriminacion: 1, aplicacion: 1, transferencia: 1 },
		};
		for (const progreso of [todas, { ...todas, calibration: { attempts: 2, brier: 0, meanConfidence: 0.9, successRate: 0.9 } }]) {
			assert.doesNotMatch(pintar({ progreso }), /aprendid|dominad|domina/i);
		}
	});
});
