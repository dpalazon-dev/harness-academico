/**
 * El anillo de foco común (revisión de UI, 23-nov-2026): `globals.css` mantiene la ley de «sin contorno del navegador» y
 * define `anillo-foco` con el token `--ring` del tema; los controles hechos a mano de Estudio lo llevan.
 */
import React from "react";
(globalThis as Record<string, unknown>).React = React;

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgendaInicio } from "../components/estudio/agenda.tsx";
import { ListaPorDecidir } from "../components/estudio/por-decidir.tsx";
import { ErrorDeLectura } from "../components/estudio/error-lectura.tsx";

const nada = () => {};
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("anillo de foco común", () => {
	it("globals.css sigue sin contorno del navegador y define el anillo con el token del tema, solo con :focus-visible", () => {
		assert.match(css, /\*:focus,\s*\*:focus-visible \{\s*outline: none;\s*\}/);
		assert.match(css, /@utility anillo-foco \{\s*@apply outline-none focus-visible:ring-2 focus-visible:ring-ring;\s*\}/);
	});

	it("los botones hechos a mano lo llevan", () => {
		const agenda = renderToStaticMarkup(<AgendaInicio datos={{ hoy: "2026-11-14", dias: {} }} ahora={new Date("2026-11-14T10:00:00")} ocupado={false} acciones={{ repasar: nada, paso: nada, abrirUnidad: nada, abrirConversacion: nada }} onRangos={nada} />);
		for (const texto of ["Hoy", "Próximos 7 días", "Elegir rango"]) assert.match(agenda, new RegExp(`<button[^>]*class="anillo-foco [^"]*"[^>]*>${texto}</button>`), texto);
		assert.match(agenda, /<button[^>]*class="anillo-foco [^"]*"[^>]*>(<svg[\s\S]*?<\/svg>)?Ver el mes/);
		const porDecidir = renderToStaticMarkup(<ListaPorDecidir lectura={{ unidades: [{ id: "u1", revision: 1, titulo: "Planaridad", capacidad: "", notas: "", planId: null }], cambios: [], borradores: [] }} ocupado={false} error={null}
			acciones={{ abrirUnidad: nada, confirmarUnidad: nada, descartarUnidad: nada, aplicarCambio: nada, rechazarCambio: nada, confirmarBorrador: nada, descartarBorrador: nada }} />);
		assert.match(porDecidir, /<button[^>]*class="anillo-foco [^"]*"[^>]*>Planaridad<\/button>/);
		assert.match(renderToStaticMarkup(<ErrorDeLectura que="x" reintentar={nada} />), /class="anillo-foco [^"]*"[^>]*>Reintentar/);
	});
});
