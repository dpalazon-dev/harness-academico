"use client";

import { useEffect, useState } from "react";
import { llamarEstudio } from "./llamar";

/** Lo que devuelve la operación `aporta` del plugin Estudio (plugins/estudio/src/aporta.ts). */
export interface Aportacion {
	instrucciones: { id: string; nombre: string; proposito: string; agentes: ("prober" | "teacher")[] }[];
	herramientas: { nombre: string; descripcion: string }[];
}

const AGENTE: Record<"prober" | "teacher", string> = { prober: "Sondeador", teacher: "Tutor" };

function agentes(lista: readonly ("prober" | "teacher")[]): string {
	const nombres = lista.map((a) => AGENTE[a]);
	return nombres.length > 1 ? `${nombres.slice(0, -1).join(", ")} y ${nombres.at(-1)}` : (nombres[0] ?? "");
}

/** La lista, en estático: las instrucciones que Estudio añade y, salvo `soloInstrucciones`, las herramientas que da. */
export function ListaAportacion({ aportacion, soloInstrucciones = false }: { aportacion: Aportacion; soloInstrucciones?: boolean }) {
	return (
		<div className="flex flex-col gap-4" data-testid="aportacion-estudio">
			<div>
				{!soloInstrucciones && <p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground/70">Instrucciones que añade</p>}
				<ul className="flex flex-col gap-2">
					{aportacion.instrucciones.map((i) => (
						<li key={i.id} data-testid={`aporta-instruccion-${i.id}`}>
							<span className="block font-prose text-(length:--lh-prose-size)">{i.nombre}</span>
							<span className="block text-xs text-muted-foreground/70">{i.proposito} · Las usa: {agentes(i.agentes)}</span>
						</li>
					))}
				</ul>
			</div>
			{!soloInstrucciones && (
				<div>
					<p className="mb-1 text-xs uppercase tracking-widest text-muted-foreground/70">Herramientas que da al tutor</p>
					<ul className="flex flex-col gap-2">
						{aportacion.herramientas.map((h) => (
							<li key={h.nombre} data-testid={`aporta-herramienta-${h.nombre}`}>
								<code className="block text-xs">{h.nombre}</code>
								<span className="block text-xs text-muted-foreground/70">{h.descripcion}</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}

export type EstadoAportacion = { aportacion: Aportacion } | { error: string } | null;

/** Lee `aporta` del plugin una vez; null mientras carga. */
export function useAportacion(): EstadoAportacion {
	const [estado, setEstado] = useState<EstadoAportacion>(null);
	useEffect(() => {
		let vivo = true;
		llamarEstudio<Aportacion>("aporta")
			.then((aportacion) => {
				if (!vivo) return;
				const valida = Array.isArray(aportacion?.instrucciones) && Array.isArray(aportacion?.herramientas);
				setEstado(valida ? { aportacion } : { error: "respuesta inesperada" });
			})
			.catch((e: unknown) => { if (vivo) setEstado({ error: e instanceof Error ? e.message : String(e) }); });
		return () => { vivo = false; };
	}, []);
	return estado;
}

/** Pinta lo que aporta Estudio; si no responde (desactivado), lo dice. */
export function VistaAportacion({ estado, soloInstrucciones = false }: { estado: EstadoAportacion; soloInstrucciones?: boolean }) {
	if (estado === null) return <p className="text-xs text-muted-foreground/70">Cargando lo que aporta Estudio…</p>;
	if ("error" in estado) return <p className="text-xs text-muted-foreground/70">Estudio no respondió: {estado.error}</p>;
	return <ListaAportacion aportacion={estado.aportacion} soloInstrucciones={soloInstrucciones} />;
}

/** Ajustes › Estudio. */
export function AportacionEstudio() {
	return <VistaAportacion estado={useAportacion()} />;
}
