/**
 * Las tintas de los cuadernos (ticket 12f): un conjunto pequeño de nombres que se resuelven con colores que el tema ya define
 * (nunca un color suelto) y que se leen en todos los temas de la aplicación. El contraste se calcula con los colores reales
 * de cada tema integrado, mezclados como los mezcla el navegador (`color-mix` en oklab).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BUILTIN_THEMES } from "../src/core/themes.ts";
import { TINTAS, TINTA_POR_DEFECTO, MEZCLA_TINTA, colorDeTinta, tintaDe } from "../components/estudio/tintas.ts";

const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const unlin = (v: number) => { const x = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055; return Math.min(1, Math.max(0, x)) * 255; };
const rgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
const aLab = (h: string) => {
	const [r, g, b] = rgb(h).map(lin) as [number, number, number];
	const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
	return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const deLab = ([L, a, b]: number[]) => {
	const l = (L! + 0.3963377774 * a! + 0.2158037573 * b!) ** 3, m = (L! - 0.1055613458 * a! - 0.0638541728 * b!) ** 3, s = (L! - 0.0894841775 * a! - 1.291485548 * b!) ** 3;
	return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(unlin);
};
const mezclar = (tinta: string, base: string, pct: number) => { const A = aLab(tinta), B = aLab(base); return deLab(A.map((v, i) => (v * pct + B[i]! * (100 - pct)) / 100)); };
const luminancia = (c: number[]) => { const [r, g, b] = c.map(lin) as [number, number, number]; return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contraste = (a: number[], b: number[]) => { const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p) as [number, number]; return (x + 0.05) / (y + 0.05); };

/** La variable del tema que cada tinta resuelve, y el color que el tema le da. */
const COLOR_DEL_TEMA = { "--lh-accent": "accent", "--lh-success": "success", "--lh-warning": "warning", "--lh-error": "error", "--foreground": "text" } as const;

describe("las tintas del cuaderno", () => {
	it("son un conjunto pequeño, con la del acento por defecto, y cada una nombra una variable del tema", () => {
		assert.ok(TINTAS.length >= 4 && TINTAS.length <= 6);
		assert.equal(TINTA_POR_DEFECTO, "acento");
		assert.equal(new Set(TINTAS.map(t => t.id)).size, TINTAS.length);
		for (const t of TINTAS) {
			assert.ok(t.etiqueta.length > 0, "tiene nombre visible");
			assert.ok(Object.keys(COLOR_DEL_TEMA).includes(t.variable), `${t.id}: ${t.variable} es un token del tema`);
			assert.match(colorDeTinta(t.id), new RegExp(t.variable.replace(/[-]/g, "\-")), "se resuelve con su token");
			assert.doesNotMatch(colorDeTinta(t.id), /#[0-9a-f]{3,8}|rgb\(|hsl\(/i, "ningún color suelto");
		}
	});

	it("una tinta desconocida o ausente se lee como la de por defecto", () => {
		assert.equal(tintaDe(undefined), "acento");
		assert.equal(tintaDe("fucsia" as never), "acento");
		assert.equal(colorDeTinta(undefined), colorDeTinta("acento"));
		assert.equal(tintaDe("rojo"), "rojo");
	});

	it("en los 11 temas integrados, claros y oscuros, cada tinta se distingue de la página al menos 3 a 1 (subrayado y filo de la tarjeta)", () => {
		assert.ok(BUILTIN_THEMES.length >= 11);
		const peores: string[] = [];
		for (const tema of BUILTIN_THEMES) {
			const c = tema.colors as unknown as Record<string, string>;
			for (const t of TINTAS) {
				const base = c[COLOR_DEL_TEMA[t.variable as keyof typeof COLOR_DEL_TEMA]]!;
				const color = t.variable === "--foreground" ? rgb(base) : mezclar(base, c.text!, MEZCLA_TINTA);
				const razon = contraste(color, rgb(c.background!));
				if (razon < 3) peores.push(`${tema.name} (${tema.mode}) ${t.id}: ${razon.toFixed(2)}`);
			}
		}
		assert.deepEqual(peores, []);
	});
});

describe("la copia del cliente y el plugin no se separan", () => {
	it("las tintas, el tope del propósito y «Solo escucha» son los mismos a los dos lados", async () => {
		const plugin = await import("../plugins/estudio/src/notebooks/types.ts");
		const cliente = await import("../components/estudio/cuadernos.ts");
		assert.deepEqual(TINTAS.map(t => t.id), [...plugin.INKS]);
		assert.equal(TINTA_POR_DEFECTO, plugin.DEFAULT_INK);
		assert.equal(cliente.MAX_PROPOSITO, plugin.MAX_PURPOSE);
		assert.equal(cliente.SOLO_ESCUCHA, plugin.SOLO_ESCUCHA);
		assert.ok(cliente.PROPUESTAS_PROPOSITO.includes(plugin.SOLO_ESCUCHA));
	});
});
