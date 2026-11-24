import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { anidarRamas, coincide, metaDe, repartir, SIN_META, type MetaConversacion } from "../components/estudio/estado-conversaciones.ts";

const c = (id: string, title = id) => ({ id, title });

describe("lista de conversaciones — estado y metadatos", () => {
	it("deriva el estado de la fila del núcleo", () => {
		assert.equal(metaDe({ id: "a", busy: true, pendingQuestion: true }).estado, "trabajando");
		assert.equal(metaDe({ id: "a", compacting: true }).estado, "trabajando");
		assert.equal(metaDe({ id: "a", pendingQuestion: true }).estado, "te-espera");
		assert.equal(metaDe({ id: "a", pendingProblem: true }).estado, "te-espera");
		assert.deepEqual(metaDe({ id: "a" }), SIN_META);
		assert.deepEqual(metaDe({ id: "a", pinned: true, archived: true, forkedFrom: { chatId: "o" } }), { estado: "terminada", fijada: true, archivada: true, bifurcadaDe: "o" });
	});
	it("busca sin distinguir mayúsculas ni tildes", () => {
		assert.equal(coincide("Límites y derivadas", "limites"), true);
		assert.equal(coincide("Límites", "  "), true);
		assert.equal(coincide("Integrales", "deriv"), false);
	});
	it("reparte fijadas, archivadas y el resto, y filtra las tres", () => {
		const meta = (id: string): MetaConversacion => ({ ...SIN_META, fijada: id.startsWith("f"), archivada: id.startsWith("x") });
		const lista = [c("f1", "Plan ML"), c("r1", "Regla"), c("x1", "Regla vieja"), c("r2", "Otra")];
		const todo = repartir(lista, meta, "");
		assert.deepEqual([todo.fijadas, todo.resto, todo.archivadas].map(l => l.map(x => x.id)), [["f1"], ["r1", "r2"], ["x1"]]);
		assert.deepEqual(todo.activas, []);
		const buscado = repartir(lista, meta, "regla");
		assert.deepEqual([buscado.fijadas, buscado.resto, buscado.archivadas].map(l => l.map(x => x.id)), [[], ["r1"], ["x1"]]);
	});
	it("las activas (trabajando o te espera) suben a su grupo, antes que las fijadas", () => {
		const meta = (id: string): MetaConversacion => ({ ...SIN_META, fijada: id === "f", estado: id === "t" ? "trabajando" : id === "e" ? "te-espera" : "terminada", archivada: id === "x" });
		const r = repartir([c("f"), c("t"), c("e"), c("r")], meta, "");
		assert.deepEqual(r.activas.map(x => x.id), ["t", "e"]);
		assert.deepEqual(r.fijadas.map(x => x.id), ["f"]);
		assert.deepEqual(r.resto.map(x => x.id), ["r"]);
	});
	it("anida cada rama bajo su origen si está en la misma lista", () => {
		const padres: Record<string, string> = { b: "a", c: "b", z: "fuera" };
		const meta = (id: string): MetaConversacion => ({ ...SIN_META, bifurcadaDe: padres[id] ?? null });
		const filas = anidarRamas([c("c"), c("a"), c("z"), c("b")], meta);
		assert.deepEqual(filas.map(f => `${f.conversacion.id}${f.nivel}`), ["a0", "b1", "c2", "z0"]);
	});
	it("un ciclo no hace desaparecer filas", () => {
		const meta = (id: string): MetaConversacion => ({ ...SIN_META, bifurcadaDe: id === "a" ? "b" : "a" });
		assert.equal(anidarRamas([c("a"), c("b")], meta).length, 2);
	});
});
