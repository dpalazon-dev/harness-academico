"use client";

/**
 * Un dibujo del tutor (ticket 12h): un diagrama Mermaid pintado en tinta, bajo el párrafo del que cuelga o dentro de su hilo.
 * Lo escribe el modelo y se pinta en el navegador de David, así que pasa por el renderizador único de la aplicación
 * (`components/mermaid-render.ts`, nivel de seguridad «strict»: sin HTML ni scripts en las etiquetas ni enlaces que se
 * ejecuten) y, antes, se le quita cualquier directiva `%%{ }%%`, que podría cambiar cómo se dibuja.
 *
 * Los colores son los del tema y la tinta (la del cuaderno o la del personaje que dibuja): se leen del navegador ya resueltos y
 * se pasan a Mermaid como variables de su tema base, para que el trazo, las flechas y el texto se lean en claro y en oscuro.
 * Un diagrama que no compila no rompe nada: muestra el error y el texto del diagrama.
 */
import { useEffect, useRef, useState } from "react";
import { XIcon } from "lucide-react";
import { useAppearance } from "@/components/settings/appearance";
import { cn } from "@/lib/utils";
import { colorDeTinta } from "./tintas";

const TINTA = `var(--tinta-margen, ${colorDeTinta(undefined)})`;

/** El código sin las directivas de inicialización: lo guardado ya viene limpio, esto es el cinturón. */
export function sinDirectivas(codigo: string): string {
	let s = codigo.trim();
	// Hasta que no cambie: quitar una directiva puede juntar las piezas de otra, y el frontmatter también puede configurar.
	for (let antes = ""; antes !== s;) { antes = s; s = s.replace(/^---[\s\S]*?\n---\s*\n/, "").replace(/%%\{[\s\S]*?\}%%/g, "").trim(); }
	return s.includes("%%{") ? "" : s;
}

/** Los tres colores de un dibujo, ya resueltos a `#rrggbb`: la tinta, el texto de la página y su fondo. */
export interface ColoresDibujo { tinta: string; texto: string; fondo: string }

const canal = (hex: string, i: number) => Number.parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
const aHex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
/** `pct` por ciento de `a` sobre `b`. */
export function mezclar(a: string, b: string, pct: number): string {
	return `#${[0, 1, 2].map(i => aHex((canal(a, i) * pct + canal(b, i) * (100 - pct)) / 100)).join("")}`;
}

/** El tema del dibujo como directiva de Mermaid: su tema base con los colores de la página. El relleno es la tinta muy diluida. */
export function directivaDeTema({ tinta, texto, fondo }: ColoresDibujo, fontFamily: string): string {
	const nodo = mezclar(tinta, fondo, 14);
	const themeVariables = {
		fontFamily, background: fondo, textColor: texto, lineColor: tinta, arrowheadColor: tinta,
		primaryColor: nodo, primaryBorderColor: tinta, primaryTextColor: texto,
		secondaryColor: nodo, secondaryBorderColor: tinta, secondaryTextColor: texto,
		tertiaryColor: fondo, tertiaryBorderColor: tinta, tertiaryTextColor: texto,
		mainBkg: nodo, nodeBorder: tinta, nodeTextColor: texto, titleColor: texto,
		clusterBkg: fondo, clusterBorder: tinta, edgeLabelBackground: fondo, labelBackgroundColor: fondo,
		actorBkg: nodo, actorBorder: tinta, actorTextColor: texto, actorLineColor: tinta, signalColor: tinta, signalTextColor: texto,
		labelBoxBkgColor: nodo, labelBoxBorderColor: tinta, labelTextColor: texto, loopTextColor: texto,
		noteBkgColor: nodo, noteBorderColor: tinta, noteTextColor: texto, activationBkgColor: nodo, activationBorderColor: tinta, sequenceNumberColor: fondo,
		transitionColor: tinta, transitionLabelColor: texto, stateLabelColor: texto, stateBkg: nodo, compositeBackground: fondo, altBackground: nodo, classText: texto,
	};
	return `%%{init: ${JSON.stringify({ theme: "base", themeVariables, htmlLabels: false, flowchart: { htmlLabels: false, wrappingWidth: 190 } })}}%%`;
}

/** Los colores de verdad de un elemento: la tinta (`--tinta-margen`), el texto y el fondo, tal como el navegador los resuelve.
 * Sin lienzo donde leerlos (una prueba sin navegador) no hay colores y se pinta con el tema claro u oscuro de Mermaid. */
export function resolverColores(el: HTMLElement): ColoresDibujo | null {
	try {
		const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
		if (!ctx) return null;
		const leer = (expresion: string): string => {
			const sonda = document.createElement("span");
			sonda.style.color = expresion;
			el.append(sonda);
			const css = getComputedStyle(sonda).color;
			sonda.remove();
			ctx.clearRect(0, 0, 1, 1);
			ctx.fillStyle = "#000000";
			ctx.fillStyle = css;
			ctx.fillRect(0, 0, 1, 1);
			const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
			return `#${aHex(r!)}${aHex(g!)}${aHex(b!)}`;
		};
		return { tinta: leer(TINTA), texto: leer("var(--foreground)"), fondo: leer("var(--background)") };
	} catch {
		return null;
	}
}

/** Hasta dónde puede encogerse un dibujo para caber en su alto, respecto a su tamaño natural: por debajo el texto no se lee. */
export const ESCALA_MINIMA = 0.6;

/** El alto mínimo (px) de un dibujo: su alto natural por la escala mínima. Un diagrama muy alto no se encoge hasta ser una línea:
 * se queda en esa escala y el contenedor, con su tope de alto, deja desplazarlo. 0 si el SVG no dice su tamaño. */
export function altoMinimo(svg: string): number {
	const caja = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+[\d.]+[\s,]+([\d.]+)\s*"/.exec(svg.slice(0, 600));
	const alto = caja ? Number(caja[1]) : 0;
	return Number.isFinite(alto) && alto > 0 ? Math.round(alto * ESCALA_MINIMA) : 0;
}

export type EstadoDibujo = { svg: string } | { error: string } | null;

/** Lo que se ve de un dibujo: pintándose, el diagrama o su error con el texto. Sin lógica: el estado llega de fuera. */
export function DibujoMarco({ id, estado, codigo, firma, quitar, compacto = false, marco }: {
	id: string;
	estado: EstadoDibujo;
	codigo: string;
	/** Quién lo dibujó. */
	firma: string;
	/** Quitar el dibujo; sin esta acción no hay botón. */
	quitar?(): void;
	/** En el hilo, dentro del margen: sin sangrado ni alto de página. */
	compacto?: boolean;
	marco?: React.Ref<HTMLElement>;
}) {
	return (
		<figure
			ref={marco} data-dibujo={id} data-estado={estado === null ? "pintando" : "svg" in estado ? "listo" : "error"}
			style={{ backgroundColor: `color-mix(in oklab, ${TINTA} 8%, var(--card))`, ...(estado && "error" in estado ? { outline: "1px solid var(--lh-error)" } : {}) }}
			className={cn("group/dibujo relative rounded-lg px-3 py-2 font-prose", compacto ? "my-2" : "my-3")}
		>
			<figcaption className="flex items-center gap-1.5 font-sans text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
				<span>Dibujo</span>
				<span aria-hidden="true">·</span>
				<span data-firma>{firma}</span>
				{quitar && (
					<button
						type="button" data-recorrido data-quitar-dibujo onClick={quitar} aria-label="Quitar el dibujo" title="Quitar el dibujo"
						className="ml-auto inline-flex size-5 items-center justify-center rounded-md opacity-0 outline-none hover:bg-accent hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/dibujo:opacity-60"
					><XIcon className="size-3.5" /></button>
				)}
			</figcaption>
			{estado === null && <p role="status" className="py-3 text-xs text-muted-foreground motion-safe:animate-pulse">Dibujando…</p>}
			{estado && "svg" in estado && (
				<div
					role="img" aria-label={`Dibujo de ${firma}`} data-dibujo-svg
					style={{ "--alto-min": `${altoMinimo(estado.svg)}px` } as React.CSSProperties}
					className={cn(
						"mt-1 overflow-x-hidden overflow-y-auto text-foreground [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full [&_svg]:min-h-[var(--alto-min)]",
						compacto ? "max-h-72 [&_svg]:max-h-64" : "max-h-[28rem] [&_svg]:max-h-[26rem]",
					)}
					dangerouslySetInnerHTML={{ __html: estado.svg }}
				/>
			)}
			{estado && "error" in estado && (
				<div data-dibujo-error className="mt-1 text-xs">
					<p role="alert" className="whitespace-pre-wrap text-destructive">No se pudo dibujar: {estado.error}</p>
					<pre data-dibujo-codigo className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-4 text-muted-foreground">{codigo}</pre>
				</div>
			)}
		</figure>
	);
}

const recorte = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

/** El dibujo conectado: lo pinta con el renderizador de la aplicación, en el modo del tema, y vuelve a pintarlo si cambian el
 * tema, la tinta o el código. `clave` cambia cuando cambia la tinta (la del cuaderno o la del personaje). */
export function DibujoMermaid({ id, codigo, firma, clave = "", quitar, compacto }: {
	id: string; codigo: string; firma: string; clave?: string; quitar?(): void; compacto?: boolean;
}) {
	const { resolvedMode, colors } = useAppearance();
	const marco = useRef<HTMLElement>(null);
	const [estado, setEstado] = useState<EstadoDibujo>(null);
	useEffect(() => {
		let vivo = true;
		setEstado(null);
		void (async () => {
			try {
				const colores = marco.current ? resolverColores(marco.current) : null;
				// El renderizador (y Mermaid con él) se carga al pintar el primer dibujo, no con el editor.
				const { renderMermaid, mermaidConfig } = await import("@/components/mermaid-render");
				const fuente = sinDirectivas(codigo);
				// La letra del tema base de Mermaid no es la de su configuración: sin pasarla, mide con una y pinta con otra y recorta las etiquetas.
				const letra = mermaidConfig(resolvedMode).fontFamily!;
				const svg = await renderMermaid(colores ? `${directivaDeTema(colores, letra)}\n${fuente}` : fuente, resolvedMode);
				if (vivo) setEstado({ svg });
			} catch (e) {
				if (vivo) setEstado({ error: recorte(e instanceof Error ? e.message : String(e), 400) });
			}
		})();
		return () => { vivo = false; };
	}, [codigo, resolvedMode, colors, clave]);
	return <DibujoMarco id={id} estado={estado} codigo={codigo} firma={firma} quitar={quitar} compacto={compacto} marco={marco} />;
}
