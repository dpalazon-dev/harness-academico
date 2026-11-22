/**
 * «Por decidir» (ticket 02 de la segunda ronda): las tarjetas de decisión que antes pintaba la bandeja del inicio,
 * ahora en el panel que abre la barra lateral. Render estático de la lista, como las demás piezas del armazón.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ListaPorDecidir, totalPorDecidir } from "../components/estudio/por-decidir.tsx";
import type { LecturaPorDecidir } from "../components/estudio/tipos.ts";

const nada = () => {};
const acciones = {
	abrirUnidad: nada, confirmarUnidad: nada, descartarUnidad: nada, aplicarCambio: nada, rechazarCambio: nada, confirmarBorrador: nada, descartarBorrador: nada,
};
const VACIA: LecturaPorDecidir = { unidades: [], cambios: [], borradores: [] };
const UNA_DE_CADA: LecturaPorDecidir = {
	unidades: [{ id: "u7", revision: 1, titulo: "Planaridad", capacidad: "Decidir si un grafo es plano", notas: "", planId: "p1" }],
	cambios: [{ id: "cp1", descripcion: ["Quitar «Recorridos BFS y DFS»"], motivo: "Ya lo dominas.", caducado: null }],
	borradores: [{ id: "d1", tipo: "pregunta", resumen: "¿Por qué GDN falla en WADI?", origen: "david", registros: 1 }],
};
const lista = (props: Partial<React.ComponentProps<typeof ListaPorDecidir>> = {}) =>
	renderToStaticMarkup(<ListaPorDecidir lectura={UNA_DE_CADA} ocupado={false} error={null} acciones={acciones} {...props} />);
const tarjetas = (html: string) => html.match(/<li[\s\S]*?<\/li>/g) ?? [];

describe("ListaPorDecidir", () => {
	it("una tarjeta por decisión: unidad propuesta, cambio del plan y borrador, en ese orden", () => {
		const [unidad, cambio, borrador, ...resto] = tarjetas(lista());
		assert.equal(resto.length, 0);
		assert.match(unidad!, /Unidad propuesta por el tutor[\s\S]*>Planaridad<[\s\S]*Decidir si un grafo es plano[\s\S]*>Confirmar<[\s\S]*>Descartar</);
		assert.match(cambio!, /Cambio del plan[\s\S]*Quitar «Recorridos BFS y DFS»[\s\S]*Ya lo dominas\.[\s\S]*>Aplicar<[\s\S]*>Rechazar</);
		assert.match(borrador!, /Pregunta sin confirmar<[\s\S]*¿Por qué GDN falla en WADI\?[\s\S]*>Confirmar<[\s\S]*>Descartar</, "de David, sin «del tutor»");
	});

	it("un cambio caducado dice por qué y solo deja descartarlo", () => {
		const [cambio] = tarjetas(lista({ lectura: { ...VACIA, cambios: [{ id: "cp2", descripcion: ["Añadir «Flujo»"], motivo: "", caducado: "otro cambio del plan ya tocó «Flujo»" }] } }));
		assert.match(cambio!, /Ya no se puede aplicar: otro cambio del plan ya tocó «Flujo»\.[\s\S]*>Descartar</);
		assert.doesNotMatch(cambio!, />Aplicar<|>Rechazar</);
	});

	it("un borrador del tutor lo dice", () => {
		const html = lista({ lectura: { ...VACIA, borradores: [{ id: "d2", tipo: "hecho", resumen: "GDN obtiene F1 0,81 en SWaT.", origen: "tutor", registros: 2 }] } });
		assert.match(html, /Hecho sin confirmar, del tutor/);
	});

	it("mientras opera, los botones esperan", () => {
		const botones = lista({ ocupado: true }).match(/<button[^>]*>(Confirmar|Descartar|Aplicar|Rechazar)</g) ?? [];
		assert.equal(botones.length, 6);
		for (const b of botones) assert.match(b, /disabled/);
	});

	it("enseña el error de la última decisión", () => {
		assert.match(lista({ error: "La propuesta ya no está pendiente" }), /role="alert"[^>]*>La propuesta ya no está pendiente</);
	});

	it("sin nada pendiente, lo dice", () => {
		const html = lista({ lectura: VACIA });
		assert.match(html, /Nada pendiente de tu decisión\./);
		assert.equal(tarjetas(html).length, 0);
	});

	it("mientras se lee, lo dice y no inventa un vacío; si la lectura falla, solo el error", () => {
		assert.match(lista({ lectura: null }), /Cargando…/);
		assert.doesNotMatch(lista({ lectura: null }), /Nada pendiente/);
		const fallo = lista({ lectura: null, error: "No se pudo leer lo pendiente de decidir." });
		assert.match(fallo, /role="alert"[^>]*>No se pudo leer lo pendiente de decidir\.</);
		assert.doesNotMatch(fallo, /Cargando/);
	});
});

describe("totalPorDecidir", () => {
	it("suma unidades, cambios y borradores; sin lectura, cero", () => {
		assert.equal(totalPorDecidir(UNA_DE_CADA), 3);
		assert.equal(totalPorDecidir(VACIA), 0);
		assert.equal(totalPorDecidir(null), 0);
	});
});
