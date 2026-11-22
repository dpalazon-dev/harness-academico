# Estudio

Aplicación de escritorio para aprender cualquier tema con un tutor de IA que critica lo que David produce, en lugar de producirlo por él. Su vocabulario sale de los handoffs de metodología: aprender es un cambio duradero en lo que alguien puede hacer, y estudiar es diseñar y regular experiencias que lo producen, lo revelan, lo corrigen y lo mantienen.

## Organización del estudio

**Espacio**:
Contexto de estudio de una materia, con su plan, sus unidades, sus documentos, sus cuadernos y sus conversaciones. Se elige uno activo; «Todos» no filtra.
_Avoid_: área, materia, workspace, proyecto

**Plan**:
Ruta ordenada de unidades de un espacio hacia un objetivo.
_Avoid_: ruta (como objeto), currículo

**Unidad**:
Una capacidad concreta que David quiere poder ejercer, con el criterio que demuestra que la tiene. Es la unidad de trabajo: sobre ella se estudia, se practica y se registra la evidencia.
_Avoid_: tema, tarjeta, concepto (como objeto)

**Capacidad**:
Lo que David quiere poder hacer al terminar una unidad.
_Avoid_: objetivo de aprendizaje

**Criterio**:
La actuación observable que demostraría que la capacidad existe.

**Fuente**:
Un documento de la biblioteca que una unidad usa para exponerse; se lee por páginas y se cita.
_Avoid_: paper (como término general)

**Nota de fuente**:
Lo que David captura de una fuente concreta, en sus palabras y con su localizador.

**Pregunta de recuperación**:
Una pregunta que David escribe con su respuesta y que se practica como un intento.
_Avoid_: tarjeta, flashcard

## Actividad

**Ciclo**:
Las funciones del aprendizaje que una unidad recorre de forma recursiva, no lineal: definir la capacidad, recuperar lo que se sabe, exponerse y capturar, retirar la fuente y reconstruir, contrastar y corregir, integrar, usar, recuperar tras un intervalo y diagnosticar.
_Avoid_: pipeline, flujo, fases (como secuencia obligatoria)

**Grupos del ciclo**:
Las cuatro formas de mostrar el ciclo de una unidad, sin orden obligatorio: orientar (capacidad y volcado inicial), exponer y capturar (fuentes y notas), reconstruir y contrastar (cierre de bloque y primeros intentos), mantener y usar (repasos, aplicación y uso).

**Volcado inicial**:
Lo que David escribe, sin ayuda, sobre lo que sabe, cree, no sabe y se pregunta de una unidad antes de exponerse a la fuente.
_Avoid_: diagnóstico inicial, test previo

**Cierre de bloque**:
Reconstrucción sin mirar al terminar un bloque de trabajo, contraste del tutor, reparación de David y una línea suya de cambio (Δ) y dudas (?). No cuenta como evidencia para el repaso.

**Intento**:
Una práctica de una unidad: confianza declarada, respuesta sin fuente, contraste y valoración. Es la evidencia de la que salen la etapa y los repasos.
_Avoid_: ejercicio, test, flashcard

**Repaso**:
Un intento que el regulador programa tras un intervalo.

**Sesión de estudio**:
Un bloque de trabajo de David sobre una o varias unidades, con un antes, un durante y un después. Es lenguaje para hablar del trabajo, no un registro.
_Avoid_: «sesión» a secas

**Conversación**:
Un chat de David con el tutor.
_Avoid_: sesión, chat (en la interfaz)

**Paso propuesto**:
La siguiente acción que la aplicación sugiere para una unidad o para el día, con su motivo en una frase. Nunca bloquea otras acciones.
_Avoid_: tarea obligatoria, siguiente fase

**Propuesta**:
Un cambio del plan o una unidad nueva que sugiere el tutor y que no se aplica hasta que David lo confirma.

**Oferta del margen** (en el código, `Propuesta` de un comentario de Cuadernos):
Lo que el tutor ofrece junto a un comentario del margen: una pregunta de recuperación, un hecho para la base o una conexión con una unidad o un cuaderno. No es una Propuesta del plan: no cambia nada hasta que David la acepta con un clic (la pregunta entra como bloque suyo tras el párrafo; el hecho, como borrador con origen tutor en «Por decidir»), y la conexión se abre sin aceptarla.
_Avoid_: propuesta (a secas, se reserva para el plan y las unidades), sugerencia

**Dibujo del tutor**:
Un diagrama Mermaid que el tutor dibuja solo si David se lo pide («Dibújalo» sobre una selección o la petición en un hilo). Es del tutor, no de la página de David: se guarda con el comentario y se pinta bajo su párrafo y en el hilo; David puede quitarlo. El modo proactivo nunca dibuja.
_Avoid_: esquema (a secas), gráfico

**Cambio caducado**:
Un cambio del plan pendiente que ya no se puede aplicar porque otro cambio aplicado después tocó sus unidades o su posición, o porque ya no encaja en el plan. Solo cabe descartarlo; en los datos queda como `obsoleta`.
_Avoid_: propuesta rechazada (eso lo decide David)

**Borrador de conocimiento**:
Un hecho para la base de conocimiento, formulado por David con su cita, pendiente de confirmar.

**Hecho del ciclo**:
Constancia de que algo del ciclo ocurrió en una unidad, como el volcado inicial, una fuente trabajada pendiente de reconstruir o un cierre de bloque. Junto con la evidencia de práctica, es de donde sale el paso propuesto.
