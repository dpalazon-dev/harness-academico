"use client";

/**
 * El modo del tutor en la cabecera del cuaderno (ticket 12e): un interruptor entre «Lee y comenta solo» y «Cuando se lo
 * pido», lo que ha gastado hoy el tutor por su cuenta frente a su tope diario (que se cambia ahí mismo) y, debajo, el aviso
 * cuando dejó de comentar solo por algo que David debe saber. Es la forma de la línea de modo de riddled.ai, con la tinta
 * del margen en el punto; ni su marca ni sus textos.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { AvisoModo, EstadoProactivo, ModoCuaderno } from "./cuadernos";
import { ETIQUETA_MODO, textoAviso, type MotivoAviso } from "./proactivo";
import { TINTA_MARGEN } from "./margen-cuaderno";

export interface ModoProactivoProps {
	modo: ModoCuaderno;
	/** Lo que cuenta el plugin del gasto de hoy; null mientras se lee. */
	estado: EstadoProactivo | null;
	/** Por qué el cuaderno dejó de comentar solo, si dejó. */
	aviso?: AvisoModo;
	/** El tutor está leyendo un párrafo ahora mismo. */
	leyendo?: boolean;
	/** Lo que el plugin respondió al intentar cambiar el modo, si no pudo. */
	error?: string | null;
	cambiarModo(modo: ModoCuaderno): void;
	fijarTope(tope: number): void;
	/** Lo que va al final de la línea del modo: el propósito del cuaderno (ticket 12f). */
	children?: ReactNode;
}

/** Por qué no se comenta solo aunque el cuaderno esté en «Lee y comenta solo»: sin modelo económico. */
export function motivoDelAviso({ modo, estado, aviso }: Pick<ModoProactivoProps, "modo" | "estado" | "aviso">): MotivoAviso | null {
	if (aviso) return aviso;
	if (modo !== "proactivo" || !estado) return null;
	if (!estado.modeloEconomico) return "sin-modelo";
	// Bajar el tope por debajo de lo gastado: el plugin pasa el cuaderno a «Cuando se lo pido» en cuanto lo intente; la cabecera
	// no espera a eso para decir lo que ya es verdad.
	return estado.usadas >= estado.tope ? "tope" : null;
}

export function ModoProactivo(props: ModoProactivoProps) {
	const { modo, estado, leyendo, error, cambiarModo, fijarTope, children } = props;
	const motivo = motivoDelAviso(props);
	/** Lo que el tutor hace de verdad: con el tope agotado no comenta solo, diga lo que diga el modo guardado. */
	const activo = modo === "proactivo" && motivo !== "tope";
	const [editando, setEditando] = useState(false);
	return (
		<div className="min-w-0" data-modo={modo}>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-sans text-xs">
				<button
					type="button" role="switch" aria-checked={activo} data-modo-interruptor
					title="Que el tutor lea mientras escribes y comente cuando paras"
					// Lo que se pide es lo contrario del modo guardado, no del que se ve: con el tope agotado el cuaderno se ve apagado pero sigue
					// guardado como «Lee y comenta solo», y pulsar debe dejarlo apagado de verdad.
					onClick={() => cambiarModo(modo === "proactivo" ? "a-peticion" : "proactivo")}
					className="inline-flex h-7 items-center gap-2 rounded-full border border-border px-2.5 text-foreground/90 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
				>
					<span
						aria-hidden="true"
						className={cn("size-2 rounded-full transition-opacity", activo ? "opacity-100" : "bg-muted-foreground/40 opacity-60", leyendo && "motion-safe:animate-pulse")}
						style={activo ? { backgroundColor: TINTA_MARGEN } : undefined}
					/>
					<span>{ETIQUETA_MODO[activo ? "proactivo" : "a-peticion"]}</span>
				</button>
				{leyendo && <span role="status" className="text-muted-foreground">Leyendo…</span>}
				{activo && estado && !motivo && (editando ? (
					<CampoTope valor={estado.tope} guardar={fijarTope} cerrar={() => setEditando(false)} />
				) : (
					<button
						type="button" onClick={() => setEditando(true)} data-tope
						title="Lecturas del tutor por su cuenta hoy, de todos tus cuadernos. Pulsa para cambiar el tope diario."
						aria-label={`El tutor ha leído ${estado.usadas} de ${estado.tope} veces hoy por su cuenta. Cambiar el tope diario.`}
						className="rounded-md px-1 tabular-nums text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
					>{estado.usadas} de {estado.tope} hoy</button>
				))}
				{children}
			</div>
			{(motivo || error) && (
				<p role="status" data-aviso={motivo ?? "error"} className={cn("mt-1.5 max-w-[34rem] font-sans text-xs leading-5", error && !motivo ? "text-destructive" : "text-muted-foreground")}>
					{error ?? textoAviso(motivo!, estado?.tope ?? 0)}
					{motivo === "tope" && estado && (
						<> <button type="button" onClick={() => setEditando(true)} className="rounded-sm underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring">Cambiar el tope</button></>
					)}
				</p>
			)}
			{motivo === "tope" && editando && estado && <div className="mt-1"><CampoTope valor={estado.tope} guardar={fijarTope} cerrar={() => setEditando(false)} /></div>}
		</div>
	);
}

/** El tope diario, editable en el sitio: Intro lo guarda, Escape lo deja como estaba. */
function CampoTope({ valor, guardar, cerrar }: { valor: number; guardar(tope: number): void; cerrar(): void }) {
	const campo = useRef<HTMLInputElement>(null);
	/** Escape deja el tope como estaba; el desenfoque que provoca el cierre no lo guarda. */
	const cancelado = useRef(false);
	useEffect(() => { campo.current?.focus(); campo.current?.select(); }, []);
	const confirmar = () => {
		if (cancelado.current) return;
		const crudo = campo.current?.value.trim() ?? "";
		// Un campo vacío no es un 0: sería apagar el modo sin querer.
		const nuevo = crudo === "" ? Number.NaN : Number(crudo);
		cerrar();
		if (Number.isSafeInteger(nuevo) && nuevo >= 0 && nuevo !== valor) guardar(nuevo);
	};
	return (
		<label className="inline-flex items-center gap-1 font-sans text-xs text-muted-foreground">
			<input
				ref={campo} type="number" min={0} max={500} step={1} defaultValue={valor} aria-label="Tope diario de lecturas del tutor"
				onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); confirmar(); } else if (e.key === "Escape") { e.preventDefault(); cancelado.current = true; cerrar(); } }}
				onBlur={confirmar}
				className="h-6 w-14 rounded-md border border-border bg-background px-1.5 text-xs tabular-nums text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
			/>
			<span>al día</span>
		</label>
	);
}
