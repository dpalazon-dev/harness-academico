import assert from "node:assert/strict";
import { test } from "node:test";
import {
	abiertosSinAtender, CONFIG_PROACTIVA, decidirLectura, estadoInicialLectura, parrafosParaLeer, textoAviso,
	type EntradaLectura, type Parrafo,
} from "@/components/estudio/proactivo";
import type { Comentario } from "@/components/estudio/cuadernos";

/* La regla de cuándo comenta el tutor por su cuenta (ticket 12e), probada con ediciones y tiempos simulados: nada de
 * temporizadores reales. El reloj es un número que el propio test mueve. */

const P1 = "→ Dijkstra mantiene un conjunto de vértices cerrados cuya distancia ya es definitiva.";
const P2 = "Funciona con pesos negativos siempre que no haya ciclos negativos, porque el camino mínimo sigue definido.";
const S = 1000;

/** Una sesión de escritura: la página, lo leído y el reloj. `escribir` y `pasar` son las dos únicas cosas que ocurren. */
function sesion(inicial: Parrafo[] = [], config = CONFIG_PROACTIVA) {
	let ahora = 0;
	let parrafos = inicial;
	let leidos = estadoInicialLectura(inicial);
	let ultimaEdicion: number | null = null;
	let ultimaLlamadaFin: number | null = null;
	const extra: Partial<EntradaLectura> = {};
	const entrada = (): EntradaLectura => ({
		ahora, ultimaEdicion, ultimaLlamadaFin, parrafos, leidos, comentados: new Set(), abiertos: 0, enVuelo: false, activo: true, fallo: false, ...extra,
	});
	return {
		escribir(id: string, texto: string) {
			parrafos = parrafos.some(p => p.id === id) ? parrafos.map(p => (p.id === id ? { id, texto } : p)) : [...parrafos, { id, texto }];
			ultimaEdicion = ahora;
		},
		pasar(ms: number) { ahora += ms; },
		decidir: () => decidirLectura(entrada(), config),
		/** La llamada terminó: el párrafo queda leído tal y como se envió. */
		leer(id: string, fin = ahora) { leidos = { ...leidos, [id]: parrafos.find(p => p.id === id)!.texto }; ultimaLlamadaFin = fin; },
		con(parcial: Partial<EntradaLectura>) { Object.assign(extra, parcial); },
		get ahora() { return ahora; },
	};
}

test("las cifras de partida son las de la spec: 8 s de pausa y tres abiertos", () => {
	assert.equal(CONFIG_PROACTIVA.pausaMs, 8 * S);
	assert.equal(CONFIG_PROACTIVA.maxAbiertos, 3);
});

test("mientras escribe no hay lectura: espera lo que falta de la pausa", () => {
	const s = sesion();
	s.escribir("a", P1);
	assert.deepEqual(s.decidir(), { accion: "esperar", enMs: 8 * S });
	s.pasar(3 * S);
	assert.deepEqual(s.decidir(), { accion: "esperar", enMs: 5 * S });
	s.pasar(4999);
	assert.deepEqual(s.decidir(), { accion: "esperar", enMs: 1 });
});

test("cada pulsación reinicia la pausa", () => {
	const s = sesion();
	s.escribir("a", P1);
	s.pasar(7 * S);
	s.escribir("a", `${P1} Y más.`);
	assert.deepEqual(s.decidir(), { accion: "esperar", enMs: 8 * S });
});

test("tras la pausa lee el párrafo nuevo", () => {
	const s = sesion();
	s.escribir("a", P1);
	s.pasar(8 * S);
	assert.deepEqual(s.decidir(), { accion: "leer", blockId: "a" });
});

test("el párrafo que ya estaba al abrir no se lee; uno cambiado, sí", () => {
	const s = sesion([{ id: "a", texto: P1 }]);
	s.pasar(60 * S);
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "sin-cambios" });
	s.escribir("a", `${P1} Con una condición añadida.`);
	s.pasar(8 * S);
	assert.deepEqual(s.decidir(), { accion: "leer", blockId: "a" });
});

test("tras leer un párrafo no vuelve a leerlo si no cambia", () => {
	const s = sesion();
	s.escribir("a", P1);
	s.pasar(8 * S);
	s.leer("a");
	s.pasar(60 * S);
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "sin-cambios" });
});

test("si el párrafo cambió mientras el tutor leía, vuelve a ser candidato tras la pausa, pero no de inmediato", () => {
	const s = sesion();
	s.escribir("a", P1);
	s.pasar(8 * S);
	s.leer("a");
	s.escribir("a", `${P1} Añado esto.`);
	assert.deepEqual(s.decidir(), { accion: "esperar", enMs: 8 * S });
	s.pasar(8 * S);
	assert.deepEqual(s.decidir(), { accion: "leer", blockId: "a" });
});

test("uno por párrafo: con comentario proactivo previo no lee ese párrafo aunque cambie", () => {
	const s = sesion();
	s.escribir("a", P1);
	s.pasar(8 * S);
	s.con({ comentados: new Set(["a"]) });
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "sin-cambios" });
});

test("con varios párrafos cambiados lee uno solo, el primero de la página, y los demás esperan su turno", () => {
	const s = sesion();
	s.escribir("a", P1);
	s.escribir("b", P2);
	s.pasar(8 * S);
	assert.deepEqual(s.decidir(), { accion: "leer", blockId: "a" });
	s.leer("a");
	// Acaba de terminar una llamada: el siguiente párrafo necesita otra pausa entera, nunca llamadas seguidas.
	assert.deepEqual(s.decidir(), { accion: "esperar", enMs: 8 * S });
	s.pasar(8 * S);
	assert.deepEqual(s.decidir(), { accion: "leer", blockId: "b" });
});

test("una sola llamada en vuelo: mientras dura no hay otra", () => {
	const s = sesion();
	s.escribir("a", P1);
	s.pasar(30 * S);
	s.con({ enVuelo: true });
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "en-vuelo" });
});

test("con tres comentarios abiertos sin atender calla; con dos, no", () => {
	const s = sesion();
	s.escribir("a", P1);
	s.pasar(8 * S);
	s.con({ abiertos: 2 });
	assert.deepEqual(s.decidir(), { accion: "leer", blockId: "a" });
	s.con({ abiertos: 3 });
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "abiertos" });
	s.con({ abiertos: 7 });
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "abiertos" });
});

test("el tope de abiertos es un parámetro: con 1, el primero ya basta para callar", () => {
	const s = sesion([], { ...CONFIG_PROACTIVA, maxAbiertos: 1 });
	s.escribir("a", P1);
	s.pasar(8 * S);
	s.con({ abiertos: 1 });
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "abiertos" });
});

test("la pausa es un parámetro: con 2 s lee a los 2 s", () => {
	const s = sesion([], { ...CONFIG_PROACTIVA, pausaMs: 2 * S });
	s.escribir("a", P1);
	s.pasar(2 * S);
	assert.deepEqual(s.decidir(), { accion: "leer", blockId: "a" });
});

test("no lee lo trivial: un párrafo más corto que el mínimo no se envía", () => {
	const s = sesion();
	s.escribir("a", "? ¿Y esto?");
	s.pasar(30 * S);
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "sin-cambios" });
	s.escribir("a", "?");
	s.pasar(30 * S);
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "sin-cambios" });
});

test("un párrafo en blanco o solo con símbolo no cuenta", () => {
	const s = sesion();
	s.escribir("a", "   ");
	s.escribir("b", "→ ");
	s.pasar(30 * S);
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "sin-cambios" });
});

test("sin modo proactivo (o sin modelo, o con el tope agotado) no hay nada que hacer, ni esperar", () => {
	const s = sesion();
	s.escribir("a", P1);
	s.pasar(30 * S);
	s.con({ activo: false });
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "inactivo" });
});

test("tras un fallo no reintenta hasta que David escriba de nuevo y haya una pausa", () => {
	const s = sesion();
	s.escribir("a", P1);
	s.pasar(8 * S);
	assert.equal(s.decidir().accion, "leer");
	// La llamada falló: el párrafo no queda leído y la regla se detiene.
	s.con({ fallo: true });
	s.pasar(120 * S);
	assert.deepEqual(s.decidir(), { accion: "nada", motivo: "fallo" });
	// Una edición cierra el fallo (el editor lo hace) y empieza una pausa nueva.
	s.con({ fallo: false });
	s.escribir("a", `${P1} Sigo.`);
	assert.deepEqual(s.decidir(), { accion: "esperar", enMs: 8 * S });
	s.pasar(8 * S);
	assert.deepEqual(s.decidir(), { accion: "leer", blockId: "a" });
});

test("secuencia entera: escribe, pausa, lee, escribe otro, pausa, lee, y a los tres abiertos calla", () => {
	const s = sesion();
	const leidas: string[] = [];
	let abiertos = 0;
	const paso = () => {
		s.con({ abiertos });
		const d = s.decidir();
		if (d.accion === "leer") { leidas.push(d.blockId); s.leer(d.blockId); abiertos++; }
		return d;
	};
	s.escribir("a", P1); s.pasar(4 * S); assert.equal(paso().accion, "esperar");
	s.pasar(4 * S); assert.equal(paso().accion, "leer");
	s.escribir("b", P2); s.pasar(8 * S); assert.equal(paso().accion, "leer");
	s.escribir("c", `${P1} (otro, tercero)`); s.pasar(8 * S); assert.equal(paso().accion, "leer");
	s.escribir("d", `${P2} (cuarto)`); s.pasar(8 * S);
	assert.deepEqual(paso(), { accion: "nada", motivo: "abiertos" });
	assert.deepEqual(leidas, ["a", "b", "c"]);
	// David atiende uno: vuelve a poder leer.
	abiertos = 2;
	assert.deepEqual(paso(), { accion: "leer", blockId: "d" });
});

test("abiertosSinAtender cuenta los abiertos a los que David no ha respondido, de cualquier origen", () => {
	const c = (state: Comentario["state"], origen?: "proactivo"): Comentario => ({
		id: `${state}-${Math.random()}`, anchor: { blockId: "a", text: "x", start: 0, end: 1, prefix: "", suffix: "" },
		persona: "tutor", kind: "pregunta", state, createdAt: "", thread: [], ...(origen ? { origen } : {}),
	});
	assert.equal(abiertosSinAtender(undefined), 0);
	assert.equal(abiertosSinAtender([c("abierto"), c("abierto", "proactivo"), c("atendido"), c("descartado")]), 2);
	// Responder en el hilo lo atiende, aunque siga abierto: el tutor vuelve a poder comentar.
	const respondido: Comentario = { ...c("abierto"), thread: [{ id: "m1", role: "tutor", text: "¿Por qué?", at: "" }, { id: "m2", role: "david", text: "Porque…", at: "" }] };
	assert.equal(abiertosSinAtender([respondido, c("abierto")]), 1);
});

test("parrafosParaLeer toma las notas con su texto como lo ve David, símbolo incluido, y deja fuera bloques y citas", () => {
	const lista = parrafosParaLeer([
		{ id: "a", kind: "nota", symbol: "?", text: "¿Por qué?", locator: "", quote: "" },
		{ id: "b", kind: "error", wrong: "x", cause: "y", fix: "z" },
		{ id: "c", kind: "nota", symbol: null, text: "Sin símbolo", locator: "", quote: "" },
	]);
	assert.deepEqual(lista, [{ id: "a", texto: "? ¿Por qué?" }, { id: "c", texto: "Sin símbolo" }]);
});

test("los avisos de la cabecera están en español y dicen qué hacer", () => {
	assert.match(textoAviso("tope", 40), /40 lecturas/);
	assert.match(textoAviso("tope", 1), /1 lectura /);
	assert.doesNotMatch(textoAviso("tope", 40), /Hoy|hoy/, "el aviso se guarda y se lee otro día");
	assert.match(textoAviso("fallos", 40), /tres/i);
	assert.match(textoAviso("sin-modelo", 40), /Ajustes/);
});
