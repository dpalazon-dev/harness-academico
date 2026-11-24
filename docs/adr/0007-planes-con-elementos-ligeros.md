---
status: accepted
---

# Planes con elementos ligeros; la unidad nace al trabajar un tema

Un plan era una lista ordenada de unidades, y la unidad es el objeto pesado del ciclo (capacidad, criterio, volcado, fuentes, intentos, repasos). Para diseñar un plan, el tutor creaba una unidad por tema: en la prueba del 23 de noviembre de 2026, 16 llamadas a `estudio_proponer_unidad` y una a `estudio_proponer_plan`, 77 s, y 16 filas en la barra. Además, toda lectura usaba un único «plan actual» por espacio. Ahora un plan es un objetivo con una lista plana y ordenada de elementos ligeros (tema, tarea, hito) que David marca a mano; un espacio tiene varios planes. El tutor propone un plan entero en una llamada, que David acepta o descarta entero; sus cambios posteriores siguen siendo propuestas. Una unidad solo nace cuando David pulsa «Trabajar» sobre un tema (o la crea él), y el tutor ya no crea unidades: solo sugiere su capacidad y criterio. El sondeo deja de crear unidades. Decidido por David el 23 de noviembre de 2026.

## Opciones consideradas

- **Plan de unidades, pero pocas**: mantiene el coste de crear el objeto pesado por adelantado y no permite tareas ni hitos.
- **Árbol de elementos**: más expresivo, pero más complejo de leer, editar y proponer; la lista plana basta.
- **Confirmación por elemento**: es lo que generaba demasiadas decisiones sueltas.

## Consecuencias

- Los datos viejos se migran al arrancar el plugin: cada unidad de un plan pasa a ser un tema enlazado, los cambios pendientes caducan y las unidades propuestas sueltas se archivan.
- El progreso del plan es la marca de David; el ciclo de una unidad no la marca solo, porque aprender no es terminar.
- La fecha de un hito es solo informativa: las fechas de repaso siguen saliendo del regulador.
