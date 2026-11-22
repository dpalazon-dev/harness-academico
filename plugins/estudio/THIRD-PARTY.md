# Atribuciones y licencias

Estudio se distribuye bajo AGPL-3.0-only, la misma licencia que LearnHarness (véase `LICENSE`). Este archivo recoge el material de terceros que contiene y lo que se consultó sin copiar.

## StudyHarness (lógica adaptada)

- Repositorio: https://github.com/Ihjas-tk/study-harness
- Commit revisado: `fd6eb70a035ac6014ae00862c3bea5e589fabda5`
- Licencia: MIT, Copyright (c) 2026 Ihjas-tk

Tres archivos de `src/assessment/` adaptan lógica de StudyHarness, traducida de Python a TypeScript:

| Archivo de Estudio | Origen en StudyHarness | Qué se adapta |
| --- | --- | --- |
| `src/assessment/calibration.ts` | `learn/src/learn/ladder.py` | Puntuación de Brier |
| `src/assessment/policy.ts` | `learn/src/learn/ladder.py` | Vocabulario de la política y escalera de repaso |
| `src/assessment/queue.ts` | `learn/src/learn/queue.py` | Orden de la cola de vencidos |

Cada uno conserva en su cabecera el aviso de copyright y el texto íntegro de la licencia MIT. El resto de `src/assessment/` (almacén, copias de seguridad, bloqueo, esquema, servicio, proyecciones, transiciones, calendario y tipos) es código propio del fork.

Nota de procedencia: `docs/integration/upstreams.json`, en la rama anterior `prep/t01-s01`, describe StudyHarness como «reference only; no code imported». Esa anotación es del 24 de octubre de 2026 y quedó superada por la adaptación descrita aquí.

Texto de la licencia:

```text
MIT License

Copyright (c) 2026 Ihjas-tk

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## DeepTutor (referencia, sin código)

- Repositorio: https://github.com/HKUDS/DeepTutor
- Commit consultado: `60fb3bdfddb30b7740c7ce3bd9b28d908f2af6db` (versión 1.7.2)
- Licencia: Apache-2.0

DeepTutor sirvió de referencia para reglas de evaluación y para la organización de la interfaz. No se ha copiado ni adaptado código, texto ni recursos gráficos suyos, por lo que su licencia no impone obligaciones sobre este plugin. Comprobado el 14 de noviembre de 2026 comparando las líneas del fork con su código fuente.

## js-yaml 4.3.2

https://github.com/nodeca/js-yaml

Licencia MIT. Dependencia de ejecución instalada desde npm; su licencia viaja en el propio paquete.
