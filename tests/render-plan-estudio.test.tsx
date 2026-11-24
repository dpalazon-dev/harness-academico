/**
 * La página de un plan (spec de planes con elementos ligeros), pintada en estático: datos de la lectura `planes`
 * dentro, marcado fuera.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PaginaPlanEstudio, rutaPlan } from "../components/estudio/plan.tsx";
import { unidadesEnOrden } from "../components/estudio/planes.ts";
import type { PlanLeido } from "../components/estudio/tipos.ts";

const nada = () => {};
const acciones = {
	cambiar: nada, editarObjetivo: nada, aceptar: nada, descartar: nada, archivar: nada, trabajar: nada,
	aplicarCambio: nada, rechazarCambio: nada, moverAEspacio: nada, navegar: nada,
};
const ciclo = { orientar: "hecho", exponer: "pendiente", reconstruir: "vacio", mantener: "vacio" } as const;
const PLAN: PlanLeido = {
	id: "p1", revision: 3, objetivo: "Aprender Machine Learning", estado: "activo", origen: "tutor", hechos: 1, total: 4,
	elementos: [
		{ id: "e1", tipo: "tema", titulo: "Regresión lineal", hecho: false, fecha: null, unidad: { id: "u1", titulo: "Regresión lineal", estado: "activa", ciclo } },
		{ id: "e2", tipo: "tema", titulo: "Árboles de decisión", hecho: false, fecha: null, unidad: null },
		{ id: "e3", tipo: "tarea", titulo: "Leer el capítulo 3", hecho: true, fecha: null, unidad: null },
		{ id: "e4", tipo: "hito", titulo: "Examen parcial", hecho: false, fecha: "2027-01-20", unidad: null },
	],
	cambios: [],
};
const pagina = (cambios: Partial<PlanLeido> = {}, extra: Partial<React.ComponentProps<typeof PaginaPlanEstudio>> = {}) =>
	renderToStaticMarkup(<PaginaPlanEstudio plan={{ ...PLAN, ...cambios }} ocupado={false} error={null} acciones={acciones} {...extra} />);

describe("PaginaPlanEstudio", () => {
	it("pinta el objetivo editable, el progreso y los elementos en orden, con su tipo", () => {
		const html = pagina();
		assert.match(html, /aria-label="Objetivo del plan"[^>]*>Aprender Machine Learning<\/textarea>/);
		assert.match(html, /1\/4/);
		assert.deepEqual([...html.matchAll(/data-elemento="([^"]+)"/g)].map(m => m[1]), ["tema", "tema", "tarea", "hito"]);
		assert.match(html, /aria-label="Tarea"/);
		assert.match(html, /aria-label="Hito"/);
	});

	it("un tema con unidad la abre y lleva su ciclo; uno sin unidad ofrece «Trabajar»", () => {
		const html = pagina();
		assert.match(html, /Abrir unidad/);
		assert.match(html, /<button[^>]*>Trabajar<\/button>/);
		assert.equal(html.match(/data-ciclo="barra"/g)?.length, 1);
	});

	it("cada elemento se marca, y un hito lleva su fecha", () => {
		const html = pagina();
		assert.match(html, /<input type="checkbox" aria-label="Desmarcar «Leer el capítulo 3» como hecho"[^>]*checked=""/);
		assert.match(html, /<input type="date"[^>]*aria-label="Fecha de «Examen parcial»"[^>]*value="2027-01-20"/);
	});

	it("es un tablero con una columna por tipo, en el orden del plan dentro de cada una", () => {
		const html = pagina({ elementos: [PLAN.elementos[2]!, PLAN.elementos[0]!, PLAN.elementos[3]!, PLAN.elementos[1]!] });
		assert.deepEqual([...html.matchAll(/data-columna="([^"]+)"/g)].map(m => m[1]), ["tema", "tarea", "hito"]);
		assert.match(html, /data-columna="tema"[\s\S]*Regresión lineal[\s\S]*Árboles de decisión[\s\S]*data-columna="tarea"[\s\S]*Leer el capítulo 3[\s\S]*data-columna="hito"[\s\S]*Examen parcial/);
		assert.match(pagina({ elementos: [PLAN.elementos[0]!] }), /aria-label="Hitos"[^>]*><li[^>]*>Ninguno</);
	});

	it("el primero de su columna no sube y el último no baja", () => {
		const html = pagina();
		assert.match(html, /aria-label="Subir «Regresión lineal»" disabled=""/);
		assert.match(html, /aria-label="Bajar «Examen parcial»" disabled=""/);
		assert.doesNotMatch(html, /aria-label="Bajar «Regresión lineal»" disabled=""/);
	});

	it("un plan propuesto se acepta o se descarta entero, y sus temas no se trabajan hasta aceptarlo", () => {
		const html = pagina({ estado: "propuesto" });
		assert.match(html, /data-testid="plan-propuesto"[\s\S]*>Aceptar<[\s\S]*>Descartar</);
		assert.match(html, /<button[^>]*disabled=""[^>]*title="Acepta primero el plan"[^>]*>Trabajar<\/button>/);
		assert.doesNotMatch(html, /Archivar el plan/);
		assert.doesNotMatch(pagina(), /data-testid="plan-propuesto"/);
	});

	it("los cambios del tutor se aplican o se rechazan; uno caducado solo se descarta", () => {
		const html = pagina({ cambios: [
			{ id: "c1", descripcion: ["Añadir el tema «SVM»"], motivo: "Te falta un clasificador de margen", caducado: null },
			{ id: "c2", descripcion: ["Quitar el tema «Regresión lineal»"], motivo: "", caducado: "otro cambio del plan ya tocó el tema «Regresión lineal»" },
		] });
		assert.match(html, /Añadir el tema «SVM»[\s\S]*Te falta un clasificador de margen[\s\S]*>Aplicar<[\s\S]*>Rechazar</);
		assert.match(html, /Ya no se puede aplicar: otro cambio[\s\S]*>Descartar</);
	});

	it("se añade un elemento eligiendo su tipo; un plan vacío lo dice", () => {
		assert.match(pagina(), /data-testid="nuevo-elemento"[\s\S]*<option value="tema"[^>]*>Tema<\/option><option value="tarea">Tarea<\/option><option value="hito">Hito<\/option>/);
		assert.match(pagina({ elementos: [], total: 0, hechos: 0 }), /El plan aún no tiene elementos/);
	});

	it("se lleva a otro espacio o se archiva", () => {
		const html = pagina({}, { espacios: [{ id: "a2", name: "Doctorado" }] });
		assert.match(html, /aria-label="Llevar el plan a otro espacio"[\s\S]*<option value="a2">Doctorado<\/option>[\s\S]*<option value="-">Sin espacio<\/option>/);
		assert.match(html, /Archivar el plan/);
	});

	it("muestra el error de la última operación", () => {
		assert.match(pagina({}, { error: "Esto cambió mientras tanto" }), /role="alert"[^>]*>Esto cambió mientras tanto</);
	});
});

describe("unidadesEnOrden", () => {
	it("las de los temas de cada plan, sin archivadas ni repetidas, y detrás las sin plan", () => {
		const archivada = { id: "e9", tipo: "tema" as const, titulo: "Vieja", hecho: false, fecha: null, unidad: { id: "u9", titulo: "Vieja", estado: "archivada" as const, ciclo } };
		const orden = unidadesEnOrden({
			planes: [{ ...PLAN, elementos: [...PLAN.elementos, archivada] }, { ...PLAN, id: "p2", elementos: [PLAN.elementos[0]!] }],
			sinPlan: [{ id: "u5", titulo: "Suelta", propuesta: false, ciclo }],
		});
		assert.deepEqual(orden.map(u => [u.id, u.enPlan]), [["u1", true], ["u5", false]]);
		assert.deepEqual(unidadesEnOrden(null), []);
	});

	it("la ruta de un plan", () => {
		assert.equal(rutaPlan("p1"), "/plan/p1");
	});
});
