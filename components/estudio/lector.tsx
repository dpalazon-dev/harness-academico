"use client";

/**
 * El lector (ticket 05, historias 28 a 30 y 34): una página de un documento
 * con su índice. Se abre desde Biblioteca o desde una fuente de la unidad y
 * vuelve a la última página leída. Al seleccionar un pasaje se puede
 * preguntar al tutor (conversación nueva con el pasaje y su página, ADR 0003),
 * guardarlo como hecho, añadirlo a las notas o copiarlo con su referencia.
 *
 * Abierto desde una unidad, las notas van a la nota de fuente de esa unidad y,
 * al cerrar el lector con capturas nuevas, la unidad registra la fuente
 * trabajada (ADR 0004), que queda pendiente de reconstruir.
 *
 * `LectorEstudio` es pura; `Lector` la conecta con el plugin. Sustituye al
 * lector de la vista antigua del plugin, retirada en el ticket 11.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { llamarEstudio } from "./llamar";
import { useAbrirConversacion } from "./abrir-conversacion";
import { rutaCuaderno } from "./cuadernos";
import {
	ESTADO_CITA, RUTA_BIBLIOTECA, entidadesDe, paginaRecordada, recordarPagina, rotuloSeccion, rutaLector,
	type ComprobacionCita, type DetalleDocumento, type PaginaDocumento,
} from "./documentos";

export interface DatosHecho { afirmacion: string; titulo: string; fecha: string; entidades: string }

export interface AccionesLector {
	cerrar(): void;
	ir(pagina: number): void;
	preguntar(pagina: number, cita: string): void;
	verificar(pagina: number, cita: string): Promise<ComprobacionCita>;
	/** Guarda la cita verificada como hecho de la base de conocimiento; cuenta como captura. */
	capturarHecho(pagina: number, cita: string, datos: DatosHecho): Promise<void>;
	/** Añade el pasaje a la nota de fuente (de la unidad, si se abrió desde una); cuenta como captura. */
	anotar(pagina: number, cita: string): Promise<{ id: string; title: string }>;
	/** Abre el cuaderno donde quedó la nota (ticket 09). */
	abrirCuaderno(id: string): void;
	copiar(texto: string): void;
}

function parrafos(texto: string): string[] {
	return texto.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}

export function LectorEstudio({ pagina: vista, detalle, unidad, capturas, ocupado, error, seleccionInicial = "", acciones }: {
	pagina: PaginaDocumento;
	detalle: DetalleDocumento | null;
	/** La unidad desde la que se abrió, si se abrió desde una. */
	unidad: { id: string; titulo: string } | null;
	/** Capturas de esta lectura, aún sin registrar en la unidad. */
	capturas: number;
	ocupado: boolean;
	error: string | null;
	seleccionInicial?: string;
	acciones: AccionesLector;
}) {
	const [cita, setCita] = useState(seleccionInicial);
	const [resultado, setResultado] = useState<{ texto: string; estado?: string; cuadernoId?: string } | null>(null);
	const [verificada, setVerificada] = useState(false);
	const pagina = useRef<HTMLElement>(null);
	// Cambiar de página descarta la selección: su cita es de la página anterior.
	useEffect(() => { setCita(seleccionInicial); setResultado(null); setVerificada(false); }, [vista.page, seleccionInicial]);

	const elegir = () => {
		const s = typeof document !== "undefined" ? document.getSelection() : null;
		const texto = s && !s.isCollapsed && s.anchorNode && pagina.current?.contains(s.anchorNode) ? s.toString().replace(/\s+\n/g, "\n").trim() : "";
		if (texto.length < 3 || texto === cita) return;
		setCita(texto);
		setResultado(null);
		setVerificada(false);
	};
	const informar = (p: Promise<unknown>, alTerminar: (v: unknown) => { texto: string; estado?: string; cuadernoId?: string }) => {
		p.then(v => setResultado(alTerminar(v))).catch(e => setResultado({ texto: e instanceof Error ? e.message : String(e), estado: "error" }));
	};

	const vistas = new Set<string>();
	const indice = (detalle?.secciones ?? []).flatMap(s => {
		const rotulo = rotuloSeccion(s.numero, s.titulo);
		if (!rotulo || vistas.has(rotulo)) return [];
		vistas.add(rotulo);
		return [{ clave: s.clave, rotulo, primera: Math.min(...s.paginas), actual: s.paginas.includes(vista.page) }];
	});

	// Una sección partida entre páginas repite su título arriba de cada una, como cabecera.
	let ultimoTitulo = "";
	const bloques = vista.blocks.map(b => {
		if (b.kind !== "seccion") {
			return (
				<figure key={b.clave} data-kind={b.kind} className="my-4 rounded-lg border border-border px-4 py-3">
					<figcaption className="text-xs text-muted-foreground">{b.kind === "tabla" ? "Tabla" : "Figura"}{b.heading ? `: ${b.heading}` : ""}</figcaption>
					{b.text.trim() && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs">{b.text}</pre>}
				</figure>
			);
		}
		const titulo = b.heading && b.heading !== ultimoTitulo ? b.heading : null;
		if (b.heading) ultimoTitulo = b.heading;
		// El texto extraído empieza por el título de la sección; ya lo muestra la cabecera.
		const cuerpo = b.heading && b.text.startsWith(b.heading) ? b.text.slice(b.heading.length) : b.text;
		return (
			<div key={b.clave}>
				{titulo && <h3 className="mb-2 mt-6 font-title text-xl">{titulo}</h3>}
				{parrafos(cuerpo).map((p, i) => <p key={i} className="mb-3 leading-relaxed">{p}</p>)}
			</div>
		);
	});

	return (
		<section
			className="mx-auto w-full max-w-5xl px-6 pb-24 pt-14 outline-none"
			data-document-id={vista.documentId}
			data-page={vista.page}
			tabIndex={-1}
			onKeyDown={(e) => {
				const t = e.target as HTMLElement;
				if (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
				if (e.key === "ArrowRight" && vista.page < vista.total) acciones.ir(vista.page + 1);
				if (e.key === "ArrowLeft" && vista.page > 1) acciones.ir(vista.page - 1);
			}}
		>
			<div className="flex flex-wrap items-center gap-2">
				<Button variant="ghost" size="sm" className="-ml-2" disabled={ocupado} onClick={acciones.cerrar}>
					<ChevronLeftIcon className="size-4" />{unidad ? "Volver a la unidad" : "Volver a la Biblioteca"}
				</Button>
				<div className="ml-auto flex items-center gap-1 text-sm" role="group" aria-label="Páginas">
					<Button variant="ghost" size="icon" aria-label="Página anterior" disabled={vista.page <= 1} onClick={() => acciones.ir(vista.page - 1)}>
						<ChevronLeftIcon className="size-4" />
					</Button>
					<input
						key={vista.page}
						type="number" name="pagina" aria-label="Página" min={1} max={vista.total} defaultValue={vista.page}
						onKeyDown={(e) => { if (e.key === "Enter") { const n = Number(e.currentTarget.value); if (n >= 1 && n <= vista.total) acciones.ir(n); } }}
						onBlur={(e) => { const n = Number(e.currentTarget.value); if (n >= 1 && n <= vista.total && n !== vista.page) acciones.ir(n); }}
						className="lh-input h-8 w-16 rounded-md border border-border bg-background px-2 text-center tabular-nums text-foreground"
					/>
					<span className="text-muted-foreground">de {vista.total}</span>
					<Button variant="ghost" size="icon" aria-label="Página siguiente" disabled={vista.page >= vista.total} onClick={() => acciones.ir(vista.page + 1)}>
						<ChevronRightIcon className="size-4" />
					</Button>
				</div>
			</div>
			<h1 className="mt-4 font-title text-3xl tracking-tight">{vista.title}</h1>
			{unidad && (
				<p className="mt-1 text-sm text-muted-foreground">
					Leyendo para «{unidad.titulo}». Lo que anotes queda en la unidad
					{capturas > 0 ? `; llevas ${capturas === 1 ? "1 captura nueva" : `${capturas} capturas nuevas`} en esta lectura.` : "."}
				</p>
			)}
			{error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}

			<div className="mt-8 grid gap-10 md:grid-cols-[13rem_minmax(0,1fr)]">
				<nav aria-label="Índice" className="hidden text-sm md:block">
					<h2 className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">Índice</h2>
					{indice.length === 0 ? <p className="text-xs text-muted-foreground">{detalle ? "La extracción no encontró secciones con título." : "Cargando…"}</p> : (
						<ol className="sticky top-4 max-h-[70vh] space-y-0.5 overflow-y-auto">
							{indice.map(s => (
								<li key={s.clave}>
									<button
										type="button"
										aria-current={s.actual ? "true" : undefined}
										onClick={() => acciones.ir(s.primera)}
										className={cn("anillo-foco flex w-full gap-2 rounded px-1.5 py-0.5 text-left hover:bg-accent", s.actual ? "text-foreground" : "text-muted-foreground")}
									>
										<span className="flex-1">{s.rotulo}</span><span className="tabular-nums">{s.primera}</span>
									</button>
								</li>
							))}
						</ol>
					)}
				</nav>

				<div>
					<article ref={pagina} onMouseUp={elegir} onKeyUp={elegir} className="font-prose text-[15px]">
						{vista.blocks.length === 0 ? <p className="text-muted-foreground">Esta página no tiene texto extraído (puede ser una imagen).</p> : bloques}
					</article>

					{cita && (
						<div role="region" aria-label="Pasaje seleccionado" className="sticky bottom-4 mt-6 max-h-[60vh] overflow-y-auto rounded-xl border border-border bg-background px-4 py-3 shadow-sm">
							<blockquote className="border-l-2 border-border pl-3 text-sm italic">{cita.length > 400 ? `${cita.slice(0, 400)}…` : cita}</blockquote>
							<div className="mt-3 flex flex-wrap gap-1">
								<Button size="sm" disabled={ocupado} onClick={() => acciones.preguntar(vista.page, cita)}>Preguntar al tutor</Button>
								<Button size="sm" variant="outline" disabled={ocupado} onClick={() => {
									setResultado({ texto: "Comprobando la cita…" });
									informar(acciones.verificar(vista.page, cita), v => {
										const c = v as ComprobacionCita;
										setVerificada(c.estado === "resuelta");
										return { texto: `${ESTADO_CITA[c.estado]}: ${c.motivo}`, estado: c.estado };
									});
								}}>Guardar como hecho</Button>
								<Button size="sm" variant="outline" disabled={ocupado} onClick={() => {
									setResultado({ texto: "Añadiendo…" });
									informar(acciones.anotar(vista.page, cita), v => ({
										texto: `Añadido a «${(v as { title: string }).title}»${unidad ? ", en la unidad" : ""}. Escribe allí qué significa para ti.`,
										cuadernoId: (v as { id: string }).id,
									}));
								}}>Añadir a mis notas</Button>
								<Button size="sm" variant="ghost" onClick={() => {
									acciones.copiar(`«${cita}» (${vista.title}, p. ${vista.page})`);
									setResultado({ texto: "Copiado con su referencia." });
								}}>Copiar con referencia</Button>
								<Button size="sm" variant="ghost" onClick={() => { setCita(""); setResultado(null); setVerificada(false); }}>Descartar</Button>
							</div>
							{resultado && (
								<p role="status" data-estado={resultado.estado} className={cn("mt-2 text-sm", resultado.estado === "error" || resultado.estado === "rota" ? "text-destructive" : "text-muted-foreground")}>
									{resultado.texto}
									{resultado.cuadernoId && (
										<>{" "}<Button variant="link" className="h-auto p-0 text-sm" onClick={() => acciones.abrirCuaderno(resultado.cuadernoId!)}>Abrir el cuaderno</Button></>
									)}
								</p>
							)}
							{verificada && (
								<CapturaHecho ocupado={ocupado} capturar={(datos) => {
									const hecho = acciones.capturarHecho(vista.page, cita, datos);
									informar(hecho, () => { setVerificada(false); return { texto: "Capturado como borrador en tu base de conocimiento." }; });
									return hecho;
								}} />
							)}
						</div>
					)}
				</div>
			</div>
		</section>
	);
}

/** La afirmación de la fuente en tus palabras, para la base de conocimiento (`renderCapture` del plugin). */
function CapturaHecho({ ocupado, capturar }: { ocupado: boolean; capturar(datos: DatosHecho): Promise<void> }) {
	const [datos, setDatos] = useState<DatosHecho>({ afirmacion: "", titulo: "", fecha: "", entidades: "" });
	const campo = "lh-input rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground";
	const cambiar = (k: keyof DatosHecho) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDatos({ ...datos, [k]: e.target.value });
	return (
		<form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); void capturar(datos).catch(() => {}); }}>
			<h4 className="text-sm font-medium">Capturar como hecho</h4>
			<textarea name="afirmacion" aria-label="Afirmación" rows={3} value={datos.afirmacion} onChange={cambiar("afirmacion")} placeholder="Qué afirma la fuente, con sus condiciones, en tus palabras" className={campo} />
			<input name="titulo" aria-label="Título breve" value={datos.titulo} onChange={cambiar("titulo")} placeholder="Título breve (opcional)" className={campo} />
			<input name="fecha" aria-label="Fecha de la fuente" value={datos.fecha} onChange={cambiar("fecha")} placeholder="Fecha de la fuente: AAAA, AAAA-MM o AAAA-MM-DD (opcional)" className={campo} />
			<textarea name="entidades" aria-label="Entidades" rows={2} value={datos.entidades} onChange={cambiar("entidades")} placeholder="Entidades, una por línea: dataset: SWaT · metodo: GDN · metrica: F1" className={campo} />
			<div><Button size="sm" type="submit" disabled={ocupado || !datos.afirmacion.trim()}>Capturar afirmación</Button></div>
		</form>
	);
}

/** Registra en la unidad la fuente trabajada; `keepalive` deja que salga aunque se cierre la ventana. */
function registrarFuenteTrabajada(unitId: string, documentId: string, capturas: number): Promise<unknown> {
	return fetch("/api/plugins/estudio/call", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ operation: "registrar-fuente-trabajada", input: { unitId, documentId, capturas } }),
		keepalive: true,
	}).then(async res => {
		if (!res.ok) {
			const body = await res.json().catch(() => null) as { error?: unknown } | null;
			throw new Error(typeof body?.error === "string" ? body.error : `Estudio no respondió (${res.status})`);
		}
	});
}

/** El lector conectado: lee la página, recuerda la última leída y registra la fuente trabajada al cerrarse. */
export function Lector({ documentId, unidadId, paginaPedida, initialConfigured }: {
	documentId: string;
	unidadId: string | null;
	paginaPedida: number | null;
	initialConfigured: boolean;
}) {
	const router = useRouter();
	const conversacion = useAbrirConversacion(initialConfigured);
	const [numero, setNumero] = useState<number | null>(paginaPedida);
	const [vista, setVista] = useState<PaginaDocumento | null>(null);
	const [detalle, setDetalle] = useState<DetalleDocumento | null>(null);
	const [unidad, setUnidad] = useState<{ id: string; titulo: string } | null>(null);
	const [capturas, setCapturas] = useState(0);
	const [error, setError] = useState<string | null>(null);
	const [falta, setFalta] = useState<string | null>(null);
	const [ocupado, setOcupado] = useState(false);

	// Las capturas de esta lectura viven también en una referencia para registrarlas al desmontar o cerrar la ventana.
	const pendientes = useRef(0);
	const contar = () => { pendientes.current += 1; setCapturas(pendientes.current); };
	const registrar = useCallback(async () => {
		const n = pendientes.current;
		if (!unidadId || n === 0) return;
		pendientes.current = 0;
		setCapturas(0);
		try { await registrarFuenteTrabajada(unidadId, documentId, n); }
		catch (e) { pendientes.current += n; setCapturas(pendientes.current); throw e; }
	}, [unidadId, documentId]);
	useEffect(() => {
		const alSalir = () => { void registrar().catch(() => {}); };
		window.addEventListener("pagehide", alSalir);
		return () => { window.removeEventListener("pagehide", alSalir); alSalir(); };
	}, [registrar]);

	useEffect(() => { if (numero === null) setNumero(paginaRecordada(documentId) ?? 1); }, [numero, documentId]);
	useEffect(() => {
		let vigente = true;
		llamarEstudio<DetalleDocumento>("documento", { id: documentId })
			.then(d => { if (vigente) setDetalle(d); })
			.catch(e => { if (vigente) setFalta(e instanceof Error ? e.message : String(e)); });
		if (unidadId) {
			llamarEstudio<{ id: string; titulo: string }>("unidad", { id: unidadId })
				.then(u => { if (vigente) setUnidad({ id: u.id, titulo: u.titulo }); })
				.catch(() => { if (vigente) setUnidad(null); });
		}
		return () => { vigente = false; };
	}, [documentId, unidadId]);
	useEffect(() => {
		if (numero === null) return;
		let vigente = true;
		llamarEstudio<PaginaDocumento>("pagina", { id: documentId, page: numero })
			.then(v => {
				if (!vigente) return;
				setVista(v);
				recordarPagina(documentId, v.page);
				window.history.replaceState(window.history.state, "", rutaLector(documentId, { unidad: unidadId ?? undefined, pagina: v.page }));
			})
			.catch(e => { if (vigente) setFalta(e instanceof Error ? e.message : String(e)); });
		return () => { vigente = false; };
	}, [numero, documentId, unidadId]);

	const cerrar = async () => {
		setOcupado(true);
		setError(null);
		try {
			await registrar();
			router.push(unidadId ? `/unidad/${encodeURIComponent(unidadId)}` : RUTA_BIBLIOTECA);
		} catch (e) {
			setError(`No se pudo registrar la fuente trabajada: ${e instanceof Error ? e.message : String(e)}`);
			setOcupado(false);
		}
	};

	if (falta) {
		return (
			<div className="mx-auto max-w-2xl px-6 pt-14 font-prose">
				<p className="text-muted-foreground">No se puede abrir este documento: {falta}</p>
				<Button variant="link" className="h-auto p-0" onClick={() => router.push(RUTA_BIBLIOTECA)}>Ir a la Biblioteca</Button>
			</div>
		);
	}
	return (
		<div className="relative h-dvh overflow-y-auto font-prose">
			<div className="lh-drag absolute inset-x-0 top-0 h-13" aria-hidden="true" />
			{vista ? (
				<LectorEstudio
					pagina={vista}
					detalle={detalle}
					unidad={unidad}
					capturas={capturas}
					ocupado={ocupado || conversacion.abriendo}
					error={error ?? conversacion.error}
					acciones={{
						cerrar: () => void cerrar(),
						ir: (n) => setNumero(n),
						preguntar: (page, quote) => {
							// Preguntar también cierra la lectura: lo capturado hasta aquí queda registrado.
							void registrar().catch(() => {}).then(() => conversacion.abrir(`Pasaje de ${vista.title}`, {
								tipo: "pasaje", documentId, page, quote, ...(unidadId ? { unitId: unidadId } : {}),
							}));
						},
						verificar: (page, quote) => llamarEstudio<ComprobacionCita>("verificar-cita", { documentId, page, quote }),
						capturarHecho: async (page, quote, d) => {
							await llamarEstudio("kb-capturar-hecho", {
								documentId, page, quote, afirmacion: d.afirmacion,
								...(d.titulo.trim() ? { titulo: d.titulo.trim() } : {}),
								...(d.fecha.trim() ? { fecha: d.fecha.trim() } : {}),
								entidades: entidadesDe(d.entidades),
							});
							contar();
						},
						anotar: async (page, quote) => {
							const nb = await llamarEstudio<{ id: string; title: string }>("anotar-pasaje", { documentId, page, quote, ...(unidadId ? { unitId: unidadId } : {}) });
							contar();
							return nb;
						},
						copiar: (texto) => { void navigator.clipboard?.writeText(texto); },
						abrirCuaderno: (id) => router.push(rutaCuaderno(id)),
					}}
				/>
			) : (
				<p className="mx-auto max-w-2xl px-6 pt-14 text-sm text-muted-foreground">Cargando…</p>
			)}
			{conversacion.dialogo}
		</div>
	);
}
