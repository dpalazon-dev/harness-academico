"use client";

/**
 * Progreso (ticket 10, historia 41): lo que solo tiene sentido en conjunto en
 * el espacio activo, a partir de la traza del regulador: unidades por etapa,
 * calibración con el Brier explicado, tipos de fallo y el año de actividad
 * (ticket 06 de la segunda ronda, con la lectura `ritmo`). Sustituye a la
 * visión general de la vista antigua del plugin, retirada en el ticket 11, con
 * la misma operación, `progreso`. El historial de cada unidad no se repite: vive
 * en su página. Nada aquí dice que algo se sepa: una etapa describe la
 * evidencia, no es un veredicto.
 *
 * `ProgresoEstudio` es pura; `Progreso` la conecta con el plugin.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useServerEvent, useServerResync } from "@/components/server-events";
import { llamarEstudio } from "./llamar";
import { FALLO } from "./intento";
import { GraficoActividad } from "./ritmo";
import { useAtajoPaleta } from "./atajo-paleta";
import type { LecturaProgreso, LecturaRitmo, TipoEtapa, TipoFallo } from "./tipos";

/** El orden va de menos a más evidencia; «Sin repaso» (unidades que se practican localizando) queda aparte, al final. */
export const ETAPAS: { kind: TipoEtapa; titulo: string; pista: string }[] = [
	{ kind: "nueva", titulo: "Sin practicar", pista: "Ningún intento valorado." },
	{ kind: "practicada", titulo: "Solo práctica en sesión", pista: "Has practicado, pero aún ningún intento cuenta como evidencia." },
	{ kind: "reaprendiendo", titulo: "Reaprendiendo", pista: "Sin recuperación suficiente en el último repaso: se repasa al día siguiente." },
	{ kind: "intervalo", titulo: "Recuperadas con intervalo", pista: "Recuperadas completas y sin ayuda tras un intervalo, que crece con cada acierto." },
	{ kind: "mantenimiento", titulo: "Mantenimiento por uso", pista: "Usadas sin ayuda en contextos distintos: repaso cada 90 días." },
	{ kind: "fuera", titulo: "Sin repaso", pista: "Se practican localizando en la fuente: no se les programan repasos." },
];

export const PISTA_FALLO: Record<TipoFallo, string> = {
	acceso: "no lo recuperas", precision: "lo recuperas con errores", estructural: "falla cómo encaja",
	discriminacion: "lo confundes con algo cercano", aplicacion: "no lo aplicas", transferencia: "no lo llevas a otro contexto",
};

const pct = (x: number) => `${Math.round(x * 100)} %`;
const coma = (x: number) => x.toFixed(2).replace(".", ",");
const intentos = (n: number) => `${n} ${n === 1 ? "intento" : "intentos"}`;

/** El veredicto de la calibración compara confianza media y aciertos sin ayuda; diez puntos de margen se leen como ajuste. */
export function veredictoCalibracion(c: NonNullable<LecturaProgreso["calibration"]>): string {
	const brecha = c.meanConfidence - c.successRate;
	if (Math.abs(brecha) < 0.1) return "Tu confianza se ajusta a lo que recuperas.";
	return brecha > 0 ? "Confías más de lo que recuperas sin ayuda." : "Recuperas más de lo que crees.";
}

function Seccion({ titulo, nota, children }: { titulo: string; nota?: string; children: ReactNode }) {
	return (
		<section className="mt-10" aria-label={titulo}>
			<h2 className="font-title text-xl tracking-tight">{titulo}</h2>
			{nota && <p className="mt-1 text-sm text-muted-foreground">{nota}</p>}
			<div className="mt-4">{children}</div>
		</section>
	);
}

function Etapas({ unidades, abrirUnidad }: { unidades: LecturaProgreso["units"]; abrirUnidad(id: string): void }) {
	const atajo = useAtajoPaleta();
	if (!unidades.length) {
		return <p className="text-sm text-muted-foreground">Aún no hay unidades activas en este espacio. Confirma una en el plan o crea otra con {atajo}.</p>;
	}
	return (
		<ul className="space-y-4">
			{ETAPAS.map(e => {
				const suyas = unidades.filter(u => u.stage.kind === e.kind).sort((a, b) => a.title.localeCompare(b.title, "es"));
				if (!suyas.length) return null;
				return (
					<li key={e.kind} data-etapa={e.kind}>
						<div className="flex items-baseline gap-3">
							<span className="font-medium">{e.titulo}</span>
							<span className="tabular-nums text-muted-foreground">{suyas.length}</span>
						</div>
						<p className="text-sm text-muted-foreground">{e.pista}</p>
						<ul className="mt-1.5 flex flex-wrap gap-1.5">
							{suyas.map(u => (
								<li key={u.unitId}>
									<a
										href={`/unidad/${encodeURIComponent(u.unitId)}`}
										onClick={(ev) => { ev.preventDefault(); abrirUnidad(u.unitId); }}
										title={u.stage.label}
										className="anillo-foco inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-sm hover:bg-accent/60"
									>
										{u.title}
										{u.needsVerification && <span className="text-xs text-[var(--lh-warning)]">· pendiente de verificar</span>}
									</a>
								</li>
							))}
						</ul>
					</li>
				);
			})}
		</ul>
	);
}

function Calibracion({ c }: { c: LecturaProgreso["calibration"] }) {
	if (!c) {
		return (
			<p className="text-sm text-muted-foreground">
				Aparece cuando haya intentos que cuenten como evidencia: tras un intervalo y sin exposición a la unidad en las 24 h previas.
			</p>
		);
	}
	return (
		<div>
			<p>{veredictoCalibracion(c)}</p>
			<dl className="mt-3 grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
				{([["Confianza media", c.meanConfidence], ["Aciertos sin ayuda", c.successRate]] as const).map(([rotulo, valor]) => (
					<div key={rotulo} className="contents">
						<dt className="text-muted-foreground">{rotulo}</dt>
						<dd className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
							<div className="h-full rounded-full bg-foreground/70" style={{ width: `${valor * 100}%` }} />
						</dd>
						<dd className="tabular-nums">{pct(valor)}</dd>
					</div>
				))}
			</dl>
			{/* El cálculo, plegado: el veredicto y las barras bastan para leer la calibración. */}
			<details className="mt-4 text-sm" data-calculo-calibracion>
				<summary className="anillo-foco cursor-pointer rounded-sm text-muted-foreground hover:text-foreground">Cómo se calcula</summary>
				<p className="mt-2">
					<span className="font-medium">Brier {coma(c.brier)}</span>
					<span className="text-muted-foreground"> en {intentos(c.attempts)} que cuentan como evidencia.</span>
				</p>
				<p className="mt-1 text-muted-foreground">
					Antes de cada intento declaras tu confianza. El Brier es la media de (confianza − resultado)², con resultado 1 si
					recuperaste completo y sin ayuda y 0 si no. 0 es una calibración perfecta; 0,25 es lo que se obtiene declarando
					siempre 50 %, como quien tira una moneda; por encima, tu confianza orienta peor que ese 50 % fijo.
				</p>
			</details>
		</div>
	);
}

function Fallos({ fallos }: { fallos: LecturaProgreso["failures"] }) {
	const presentes = (Object.keys(FALLO) as TipoFallo[]).filter(f => fallos[f]).sort((a, b) => fallos[b]! - fallos[a]!);
	if (!presentes.length) return <p className="text-sm text-muted-foreground">Sin fallos registrados.</p>;
	const max = Math.max(...presentes.map(f => fallos[f]!));
	return (
		<ul className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-2 text-sm">
			{presentes.map(f => (
				<li key={f} data-fallo={f} className="contents">
					<span>{FALLO[f]} <span className="text-muted-foreground">· {PISTA_FALLO[f]}</span></span>
					<span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
						<span className="block h-full rounded-full bg-[var(--lh-warning)]" style={{ width: `${(fallos[f]! / max) * 100}%` }} />
					</span>
					<span className="tabular-nums">{fallos[f]}</span>
				</li>
			))}
		</ul>
	);
}

export function ProgresoEstudio({ progreso, actividad, error, abrirUnidad }: {
	/** null mientras carga. */
	progreso: LecturaProgreso | null;
	/** La actividad del año, de la lectura `ritmo`, o en qué está esa lectura. */
	actividad: LecturaRitmo["actividad"] | "cargando" | "fallo";
	error: string | null;
	abrirUnidad(id: string): void;
}) {
	return (
		<div className="mx-auto w-full max-w-2xl px-6 pb-24 pt-14">
			<h1 className="font-title text-4xl tracking-tight">Progreso</h1>
			<p className="mt-2 text-muted-foreground">
				La evidencia del espacio en conjunto. Solo cuenta como evidencia un intento sin exposición a la unidad en las 24 h
				previas; el resto es práctica, útil pero sin alargar ningún intervalo. El historial de cada unidad está en su página.
			</p>
			{error && <p role="alert" className="mt-4 text-sm text-destructive">{error}</p>}
			{progreso === null ? (
				!error && <p className="mt-10 text-sm text-muted-foreground">Cargando…</p>
			) : (
				<>
					<Seccion titulo="Unidades por etapa"><Etapas unidades={progreso.units} abrirUnidad={abrirUnidad} /></Seccion>
					<Seccion titulo="Calibración" nota="Cuánto se parece la confianza que declaras a lo que luego recuperas."><Calibracion c={progreso.calibration} /></Seccion>
					<Seccion titulo="Tipos de fallo" nota="En todos los intentos valorados, también los de práctica."><Fallos fallos={progreso.failures} /></Seccion>
					<Seccion titulo="Actividad del año" nota="Un día cuenta si hiciste un intento, un volcado, trabajaste una fuente, cerraste un bloque o escribiste en una conversación del espacio.">
						{actividad === "cargando" ? <p className="text-sm text-muted-foreground">Cargando…</p>
							: actividad === "fallo" ? <p className="text-sm text-muted-foreground">No se pudo leer la actividad. Se volverá a intentar con el próximo cambio.</p>
							: <GraficoActividad actividad={actividad} />}
					</Seccion>
				</>
			)}
		</div>
	);
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** La página conectada: lee `progreso` al entrar, al cambiar el espacio o cualquier dato de Estudio y al reconectar. */
export function Progreso() {
	const router = useRouter();
	const [progreso, setProgreso] = useState<LecturaProgreso | null>(null);
	const [actividad, setActividad] = useState<LecturaRitmo["actividad"] | "cargando" | "fallo">("cargando");
	const [error, setError] = useState<string | null>(null);

	const ultima = useRef(0);
	const leer = useCallback(async () => {
		const esta = ++ultima.current;
		try {
			// El año de actividad llega aparte: si su lectura falla, el resto de Progreso se pinta igual.
			void llamarEstudio<LecturaRitmo>("ritmo")
				.then(r => { if (esta === ultima.current) setActividad(r.actividad); })
				.catch(() => { if (esta === ultima.current) setActividad("fallo"); });
			const p = await llamarEstudio<LecturaProgreso>("progreso");
			if (esta !== ultima.current) return;
			setProgreso(p);
			setError(null);
		} catch (e) {
			if (esta === ultima.current) setError(mensaje(e));
		}
	}, []);
	useEffect(() => { void leer(); }, [leer]);
	useServerEvent("plugin-message", (m) => { if (m.pluginId === "estudio") void leer(); });
	useServerResync(() => void leer());

	return (
		<div className="relative h-dvh overflow-y-auto font-prose">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			<ProgresoEstudio progreso={progreso} actividad={actividad} error={error} abrirUnidad={(id) => router.push(`/unidad/${encodeURIComponent(id)}`)} />
		</div>
	);
}
