# PROJECT_STATUS.md
## Sistema FEBIU — Estado actual

---

## IDs CLAVE

| Recurso | ID |
|---|---|
| Torneo Nacional de Primera | tournamentId=19 |
| C1 Nacional de Primera | circuitId=29 |
| C2 Nacional de Primera | circuitId=27 |
| Torneo Panamericano de Primera/Máxima | tournamentId=21 |
| C1 Panamericano Máxima (Máster) | circuitId=31, phaseId=84 |
| Willy Billar Club | venueId=25, tableIds 60–65 |

**Nota:** los Panamericanos de Segunda, Tercera, Juvenil y Femenino ya existen como torneos en la base (creados desde Fixture). El fixture real del Panamericano arrancará sobre esos circuitos. Fase bracket de cada categoría = tipo `master`; fase series = tipo `clasificatorio`.

---

## ESTADO AL 29/06/2026

### COMPLETADO (29/06 — noche) — Flujo de entrada del público + instalación PWA directa a `/publico` (sin login)

Antes, el público entraba por la **misma pantalla de login** (con un link chico "Ver torneo sin login"). Confuso. Resuelto para que la app instalada y la raíz abran DIRECTO en la Vista Pública sin pasar nunca por login. **Solo frontend, 4 archivos + bump:**

1. **`public/manifest.json`**: `start_url` y `scope` cambiados de `/` a **`/publico`** → la PWA instalada arranca en la Vista Pública. Agregado `"id": "/publico"` (evita que iOS/Android mezclen instalaciones viejas). Se quitó el shortcut "Panel Juez" (apuntaba fuera del nuevo scope; algunos navegadores lo descartan). Shortcut "Ver Torneo" → `/publico` queda.
2. **`public/sw.js`**: `CACHE_NAME` bumpeado `febiu-billar-v2` → **`v3`** (invalida SW viejo; el SW ya dio problemas de caché en este proyecto). `STATIC_ASSETS` precachea `/publico` en vez de `/`. Lógica navigate (network-first, fallback `index.html`) y assets (cache-first) sin cambios.
3. **`src/App.tsx`**: la raíz `/` ya NO usa `ProtectedRoute` (que mandaba a `/login`). Ahora redirige por rol: admin→`/admin`, juez→`/juez`, **sin sesión→`/publico`**. Las rutas admin/juez siguen protegidas igual; `ProtectedRoute` sigue en uso. Catch-all `*` va a `/` (que ahora resuelve a público).
4. **`src/pages/LoginPage.tsx`**: removido el bloque del link "Ver torneo sin login →" (el público ya no pasa por login).
- `PublicPage.tsx` → `PUBLIC_BUILD = pub-public-2026-06-29-pwa-publico` (luego bumpeado de nuevo, ver punto siguiente).

**Link para el público / QR:** `https://billar-frontend-blue.vercel.app/publico` → abre directo, e instalado arranca en `/publico`. Para reinstalar limpio: desinstalar PWA vieja, cerrar navegador, reabrir `/publico`, instalar (Android: menú → Agregar a pantalla principal; iPhone: Compartir → Agregar a inicio).

**Ajuste selector de torneos (mismo día):** el selector superior de `/publico` derivaba `torneosActivos` solo de las 3 listas filtradas (en juego/pendiente/finalizado); un torneo `active` sin partidos en esas listas no aparecía. Cambiado para derivar de **`allMatches`** (todos los partidos sin importar estado), filtrando `tournament.active === true`, sin depender del nombre. `PUBLIC_BUILD = pub-public-2026-06-29-selector-allmatches`. **Sin verificar en vivo aún** (no hay partidos asignados al cierre de la sesión). ⚠️ Si tras asignar partidos el selector sigue vacío, revisar que `GET /matches` (sin filtro) popule la cadena `phase → circuit → tournament` en el `include`.

**PENDIENTE (próximo chat):** rediseño de la **vista de MESAS** en `/publico` ("Estado de Mesas", las 6 mesas venueId=25 / tableIds 60–65). Mostrar mejor qué se juega en cada mesa (jugadores, categoría, etc.). Mostrar propuesta visual ANTES de implementar.

### COMPLETADO (29/06) — Vista Pública: selector de torneo + filtrado de las 3 columnas + apócope Panamericano

Rediseño de `/publico` (`PublicPage.tsx`) para torneos simultáneos. Antes, "Últimos Resultados" mostraba lo último de TODA la base (aparecían partidos del Nacional de Primera C2 ya jugados, fase 76, aunque el simulacro Panamericano ya estaba limpio). Causa: la detección de "circuito activo" dependía de partidos en vivo; sin partidos en juego, `circuitoActivo` quedaba null y mostraba todos los finalizados.

Solución definitiva (solo frontend, backend ya tenía todo):
- **Selector de torneo** arriba de la portada. Lista SOLO torneos con `active === true` que tengan al menos un partido cargado (en curso / pendiente / finalizado). Sin opción "Todos" (decisión del usuario: confunde; el espectador debe reconocer a los jugadores para saber qué categoría ve).
- **Al entrar, las 3 columnas vacías** con mensaje "Elegí un torneo…". Recién al elegir, se filtran las 3 columnas (Partidos en Curso / Próximos / Últimos Resultados) por ese `tournament.id`.
- **Apócope de país** (URU, ARG, BRA…) al lado del nombre SOLO cuando el torneo elegido es Panamericano (`/panamericano/i` sobre el nombre del torneo). Helpers nuevos: `matchEsPana(m)`, `nombrePublico(jug, esPana)`. Reutiliza el dict `PAIS_APOCOPE` ya existente en el archivo.
- Backend NO se tocó: `GET /matches` ya acepta `?tournamentId=` y ya incluye `phase.circuit.tournament` (con flag `active`) en cada match.
- **Sección "Series y Rankings por Torneo"** (antes titulada "TORNEO NACIONAL", renombrada): su dropdown también filtra solo torneos `active === true` (línea del `.filter` en `SeccionNacional`, suma `t.active === true` al regex nacional/panamericano). El endpoint `GET /publicaciones/circuitos` ya devuelve `active` (findMany sin select).
- `PublicPage.tsx` usa marcador `// PUBLIC_BUILD = pub-public-2026-06-29-activos` al tope (no tiene BUILD_TAG propio; el comentario invalida el chunk de Vercel). Se quitó el import sin uso `playerName`.

**Requisito operativo:** el control de qué ve el público es el flag `Tournament.active`. Torneos a mostrar → activos; torneos viejos a ocultar (Nacionales terminados) → marcar inactivos. Aplica a AMBOS selectores de la vista pública y al de Fixture.

**PENDIENTE (próximo chat):** rediseñar la vista de MESAS en `/publico` y el FLUJO DE ENTRADA del público a la app. Hoy la entrada del público usa la misma pantalla que el login (solo con un texto abajo "se entra sin login"). Se quiere: (1) un link directo / instalación PWA que abra SOLO la Vista Pública sin pasar por login; (2) rediseño del estado/vista de mesas en la portada pública.

### COMPLETADO (28/06 — noche 2) — Inicio migración multi-categoría Panamericano: subtítulo dinámico + paleta Segunda bordeaux + Fixture abre en activo

Arranque de la replicación del Panamericano a las 5 categorías (Máxima ✓; Segunda/Tercera/Juvenil/Femenino se cargan desde la UI de Fixture, que YA permite crear torneo/circuito/fases, subir jugadores y generar partidos). El motor ya es genérico: rankings/matches/cruces/series aceptan `tipo === 'panamericano'`. NO se toca `schema.prisma` (la categoría la define el Tournament). Tres cambios frontend:

1. **Subtítulo dinámico de publicaciones series/inicial** (`AdminPublicacionesPage.tsx`, `PubHeader`). El `.replace(/TORNEO PANAMERICANO/gi, 'CATEGORÍA MÁXIMA')` estaba FIJO → Segunda/Tercera salían "MÁXIMA". Ahora el helper `catSubtitulo` deriva de `data.torneo`+`data.circuito` sin acentos (master/maxima→MÁXIMA, femenin→FEMENINO, juvenil→JUVENIL, segunda→SEGUNDA, tercera→TERCERA, primera→PRIMERA). Último texto fijo a Máxima cerrado.

2. **Paleta Segunda → BORDEAUX** `#6B2737` + dorado `#D4AF37` (antes marrón `#b83c00`), permanente para cualquier torneo de Segunda. Actualizada en los 4 mapas de paleta del archivo: `TEMAS.segunda`, `COLORES_CATEGORIA.segunda`, `COLORES_CATEGORIA_V2.segunda` (rampa completa derivada), `SECCION_COLORES.SEGUNDA` + `getCatColor`. `BUILD_TAG` → `pub-2026-06-28-segunda`.

3. **Fixture abre en torneo activo** (`FixturePage.tsx`, `useEffect` inicial): `r.data.find(t => t.active)` con fallback al primero (antes siempre `r.data[0]` = Nacional de Primera). ⚠️ Si hay varios activos, abre en el primer activo de la lista.

**Decisión tipos de fase (NO se cambia):** enum `PhaseType` = `clasificatorio | segunda | primera | master`. No existe "tercera". `clasificatorio` = series, `master` = bracket. Toda categoría usa clasificatorio + master. El nombre de la fase es libre; "master" es solo el tipo interno.

**Verificación 28/06:** solo 3 circuitos con inscriptos: 27 (Nac Pri C2, 32), 29 (Nac Pri C1, 32), 31 (Pana Máster, 16). Columnas reales en DB: Match → `playerAId`/`playerBId`, `serieId`, `phaseId`; Player → `firstName`/`lastName`/`pais`. La fase 76 (bracket "Etapa de Cruces") pertenece a circuit 27 = Nacional de Primera (NO es de prueba — son datos reales).

**PENDIENTE Femenino:** paleta borgoña `#7A1F3D` + dorado `#D4AF37` + antracita `#2F2F2F` SIN implementar. Juvenil queda en fallback navy/gold. El subtítulo del bracket ya contempla femenin/juvenil; falta agregar paleta Femenino a los mapas + `catPaletaFE`. Juvenil y Femenino quedan para el final (si dan los tiempos).

⚠️ **Riesgo nomenclatura:** la detección de categoría (paleta + subtítulo) busca la palabra clave en el nombre de torneo/circuito sin acentos. Cada torneo nuevo DEBE contener su palabra (`segunda`/`tercera`/`juvenil`/`femenin`).

---

## ESTADO AL 28/06/2026

### COMPLETADO (28/06 — última) — Paleta navy/gold para Categoría Máxima + arreglo header Bracket Nacional

Dos problemas en `AdminPublicacionesPage.tsx`. Solo frontend; backend NO se tocó.

1. **Panamericano Categoría Máxima salía TODO en verde; debe ser navy/gold (igual que los nacionales de Primera).** La paleta se elige con `getCatV2(...)` / `getColoresCategoria(...)` a partir de `data.categoriaFederal`. El backend `categoriaFederal()` solo distingue primera/segunda/tercera y, si el nombre del torneo Panamericano no contiene "primera", cae en el `return 'tercera'` por defecto → paleta **verde**.
   - **Solución:** nuevo helper `catPaletaFE(data)` que deriva la categoría REAL desde `data.torneo` + `data.circuito` normalizando acentos (mismo patrón que el subtítulo dinámico del bracket). Mapeo: `master|maxima|primera` → `'primera'` (navy/gold); `segunda` → segunda; `tercera` → tercera; fallback al `categoriaFederal` del backend y, si nada, `'primera'`.
   - Se reemplazaron TODOS los usos `getCatV2(data.categoriaFederal)` / `getColoresCategoria(data.categoriaFederal)` por `getCatV2(catPaletaFE(data))` / `getColoresCategoria(catPaletaFE(data))` en PubHeader, PlantillaSeriesNacional, PlantillaRankingNacional, PlantillaBracketNacional y el tema del ranking. Aplica a TODAS las publicaciones (inicial, series, ranking, cruces, bracket). Nacional/departamental quedan idénticos.

2. **El Bracket del Nacional de Primera mostraba "Confederación Panamericana de Billar 2026" + logo CPB (¡siendo nacional!).** Bug colateral del rediseño del bracket (28/06 tarde): el header quedó con kicker/título/logo CPB **hardcodeados** sin condicionar a `data.esPanamericano`.
   - **Solución:** header condicionado a `data.esPanamericano`. Nacional → kicker `FEBIU · Temporada {temporada}`, `<h1>` = `{data.torneo}` (nombre real), solo logo FEBIU. Panamericano → kicker `Confederación Panamericana de Billar {temporada}`, `<h1>` "Torneo Panamericano", logos FEBIU + CPB (como estaba). El subtítulo dinámico (`subtituloBracket`) ya funcionaba bien en ambos.

`BUILD_TAG` → `pub-2026-06-28-paleta` para forzar chunk nuevo en Vercel. TS: 28 errores preexistentes, sin cambios (ninguno nuevo).

**Lecciones:**
- Para elegir paleta por categoría NO confiar en `categoriaFederal` del backend (cae en primera/tercera para Máster). Derivar de torneo+circuito sin acentos, igual que el subtítulo del bracket. El helper `catPaletaFE(data)` centraliza esto.
- Antes de embellecer una plantilla compartida (bracket sirve a nacional Y panamericano), condicionar textos/logos específicos a `data.esPanamericano`. Hardcodear lo panamericano rompe el nacional.

---

### COMPLETADO (28/06 — noche) — Banderas en Bracket + subtítulo dinámico por categoría + franjas blancas (circuit 31)

Dos cambios visuales en la publicación **Bracket Final** (`PlantillaBracketNacional` en `AdminPublicacionesPage.tsx`) + un fix de layout. La lógica/estructura del bracket NO se tocó.

1. **Banderas de país en cada casilla del bracket.** El `Seat` ahora muestra la banderita (`banderaPaisG(pais)`) antes del nombre cuando `data.esPanamericano` es true. El backend YA enviaba `pais` dentro de `playerA`/`playerB` de cada match (`mkBracketMatch`) y en `campeon.pais`. Se agregó helper local `getPais(m, side)`. La bandera también aparece junto al nombre del **Campeón**. En nacional/departamental NO se muestra bandera (comportamiento intacto).
   - **CSS export-safe (html-to-image):** banderas con tamaño FIJO — `.bk-flag` 20×14px en casillas, `.bk-flag-champ` 22×15px en el campeón, `border-radius:2px`, `object-fit:cover`. `.bk-champ-name` pasó a `display:inline-flex; align-items:center` para alinear bandera+texto. Los anchos fijos evitan que se corten al exportar.

2. **Subtítulo dinámico por categoría.** El `.bk-subtitle` era fijo ("Bracket Final"). Ahora muestra **"Bracket Final · Categoría X"**. La categoría se deriva de `data.torneo` Y `data.circuito` (nombre del circuito), **normalizando para quitar acentos** (`.normalize('NFD').replace(/[\u0300-\u036f]/g,'')`). Mapeo: master/maxima → "Categoría Máxima", femenin → Femenino, juvenil → Juvenil, segunda → Segunda, tercera → Tercera, primera → Primera; sin match → "Bracket Final".
   - **Decisión:** NO se usó `categoriaFederal` del backend porque solo distingue primera/segunda/tercera (Máster/Juvenil/Femenino caen en "primera"). Por eso se detecta por nombre de torneo+circuito.
   - **Por qué falló en el 1er intento:** el regex buscaba solo en `data.torneo` con acentos; el torneo 21 ("Máster") no matcheaba. Se corrigió buscando también en `data.circuito` y quitando acentos. ✓ Quedó perfecto ("Bracket Final · Categoría Máxima").

3. **Franjas blancas laterales eliminadas.** El contenedor de export del bracket es de 1440px (fondo blanco) pero el `.bk-stage` (fondo oscuro) tenía `maxWidth:1180` → ~130px blancos a cada lado. Solución: el `.bk-stage` ahora llena los **1440px** (`maxWidth:1440`), mientras el contenido interno (`.bk-header` y `.bk-bracket`) se mantiene centrado a **1180px** (`max-width:1180px; margin:auto`). Así el fondo oscuro cubre todo y el bracket conserva su densidad. Los conectores SVG (`#bk-wires`) se recalculan en runtime con `getBoundingClientRect()`, así que reconectan solos.

**Lecciones:**
- Detección de categoría: normalizar acentos y mirar más de un campo (torneo + circuito) — los nombres no siempre traen la palabra donde se espera.
- Franja blanca al exportar = desajuste entre ancho del contenedor de export (1440) y ancho del fondo del stage. Llenar el fondo al ancho del export y centrar el contenido por dentro.

---

### COMPLETADO (28/06 — tarde) — Rediseño visual Bracket Final Panamericano (circuit 31)

Embellecimiento de la publicación **Bracket** (`PlantillaBracketNacional` en `AdminPublicacionesPage.tsx`). Solo cambios estéticos, la lógica/estructura del bracket no se tocó.

1. **Header con dos logos**: FEBIU (`LOGO_FEBIU_B64`) a la izquierda y CPB (`LOGO_CPB_B64`) a la derecha, flanqueando los textos centrales. Clase nueva `.bk-headlogos` (flex, gap 22px) + `.bk-headtext` + `.bk-hl` (logos 78px, círculo blanco, borde dorado).
2. **Títulos**: título principal "Torneo Panamericano" (`.bk-h1`), subtítulo "Bracket Final" (`.bk-subtitle`), kicker "Confederación Panamericana de Billar 2026" (`.bk-kicker`). Antes mostraban `{data.torneo}` / `{data.fase}` (texto fijo ahora).
3. **Logo central grande eliminado**: se quitó el bloque `.bk-logo-halo` del centro (quedaba feo). Las reglas CSS `.bk-logo-halo*` quedan en el `<style>` pero sin uso (inofensivas).
4. **Footer eliminado**: se quitó `<div className="bk-foot">FEBIU · {data.temporada}</div>`.
5. **Franja blanca eliminada**: el stage pasó de `width:1440` (fijo) a `width:'100%', maxWidth:1180, margin:'0 auto'`. Eso elimina el área blanca a la derecha al ver/exportar.
6. **Menos espacio vacío**: `bk-stage` padding `20px 28px 22px`; `.bk-bracket` `min-height:300px` (era 480); `.bk-col` `gap:14px` (era 18); `.bk-center` `gap:18px`.

**Lección:** ancho fijo del stage + contenedor más ancho = franja blanca al exportar. Usar `width:100% + maxWidth + margin auto`.

---

### COMPLETADO (28/06 — mañana) — Publicación Bracket de 8 + Ranking país/bandera (circuit 31)

Dos problemas reportados en **Publicaciones** del Panamericano Máster (circuit 31):

1. **Publicación Bracket dibujaba 16 jugadores (octavos) en vez de 8 (desde cuartos).**
   - El código (back + front) YA soportaba bracket de 8: backend `publicaciones.ts` envía `tamano` (8 si no hay `nac-oct-*`, 16 si los hay); frontend `AdminPublicacionesPage.tsx` → `PlantillaBracketNacional` usa `es8 = data.tamano === 8` y oculta columnas de octavos. La generación en `matches.ts` → `regenerar-bracket` usa `cfg.formato === '16'` → bracket de 8 (top 8, protegido `[[0,7],[3,4],[2,5],[1,6]]`, serieIds `nac-cua-1..4` + semis + final).
   - **Causa real:** los partidos del bracket en la base tenían octavos viejos generados (de antes de setear `formato:16`). `tamano` se calcula por presencia de octavos → daba 16.
   - **Solución (sin código):** confirmar `configTorneo` del circuit 31 (`tipo=panamericano`, `formato=16` — ✓ verificado) y **regenerar el bracket** con 🏆 Generar bracket → borra octavos, crea 7 partidos desde cuartos. La publicación pasa a "BRACKET 8 JUGADORES".

2. **Publicación Ranking/Inicial Panamericano mostraba "CLUB" (apócopes de club) en vez de PAÍS + bandera.**
   - El código YA estaba: `PlantillaSeriesNacional` → `ColHeader` muestra "PAÍS" si `data.esPanamericano`, y `Fila` muestra bandera+apócope (`banderaPaisG` / `apocPaisG`). Backend manda `pais` + `esPanamericano` en todas las ramas.
   - **Causa real:** el bundle de Vercel estaba viejo (`BUILD_TAG` = `pub-2026-06-12-a`) y no había tomado el commit del fix país+bandera (28/06 15:58 "ranking circuito muestra bandera junto al apocope"). El header sí actualizaba pero el chunk de la tabla no.
   - **Solución:** bump de `BUILD_TAG` → `pub-2026-06-28-pana` para forzar chunk hash nuevo + Redeploy sin caché en Vercel + Clear site data / Ctrl+Shift+R.

**Lección:** ante "el código está bien pero la app muestra lo viejo", sospechar bundle viejo en Vercel antes de reprogramar. Verificar `data-build` en el DOM y la fecha del último commit vs el deploy.

---

## ESTADO AL 27/06/2026

### COMPLETADO (27/06 — tarde) — Ranking Panamericano + reparación de series + export PNG

Resueltos cuatro problemas al cargar resultados del Panamericano Categoría Máster (circuit 31):

1. **Ranking de circuito quedaba en cero.** Causa: las ramas que tratan torneos como nacionales solo chequeaban `tipo === 'nacional'`. El Panamericano usa `tipo === 'panamericano'`. Fix en `rankings.ts`:
   - `POST /recalcular-stats/:circuitId`: `esNacional = tipo === 'nacional' || tipo === 'panamericano'`.
   - `GET /final`: la rama que lee de `RankingEntry` ahora también entra con `tipo === 'panamericano'`.
   - (En `matches.ts`, `PUT /:id/result` ya tenía el OR panamericano correcto.)
   - Las series del Panamericano usan prefijo `nac-serie-1..4` (mismo que nacional), por eso el filtro `nac-serie-*` aplica una vez que entra a la rama nacional.

2. **Slot sin resolver en Serie 3 (P5).** El P5 mostraba placeholder "Per. S3-P3" con `playerAId` null pese a estar finalizado. Causa: `propagarSerieNacional` depende del orden de carga; si el P5 se carga antes de que el P3 tenga ganador, el slot queda sin llenar. Reparado a mano con `UPDATE "Match" SET "playerAId"=852, "slotA"=NULL WHERE id=2425`.

3. **Endpoint nuevo de reparación.** `POST /matches/trigger-reparar-series/:phaseId` (en `matches.ts`): recorre todas las series `nac-serie-*` de la fase y rellena P5.slotA = perdedor del P3, P5.slotB = ganador del P4, **sin depender del orden de carga**. Usar para cualquier categoría del Panamericano si reaparece el problema.

4. **Export PNG: badge "COMPLETA" y marcador "3-0" se salían del recuadro.** Fix en `AdminPublicacionesPage.tsx` (mismo patrón que chips anteriores): ancho fijo (`minWidth`) + `textAlign:center` + `boxSizing:border-box` + `whiteSpace:nowrap`. Badge COMPLETA: `minWidth:96`, letterSpacing bajado a 0.10em. Marcador: `minWidth:54`, letterSpacing 0.02em.

5. **Tabla Ranking del Circuito adaptada a Panamericano** (`RankingFinalPage.tsx` + `rankings.ts`):
   - Backend: `GET /final` ahora incluye `pais` en el objeto de cada jugador (rama nacional/panamericano).
   - Frontend: cuando el circuito es panamericano → columna "Club" se reemplaza por "País" mostrando apócope (URU/ARG/BRA…, mismo dict que publicaciones); columna "Categoría" se oculta (la categoría la define el torneo: Máxima/Segunda/Juvenil/etc., cada uno circuito separado); buscador busca por país; badge dice "Panamericano". Nacional y departamental quedan idénticos.

6. **Puntos de cruce corregidos por tipo de torneo** (`matches.ts` → `asignarPuntosCruce`): antes asignaba 5/1 en cruces y 7/2 en final para TODOS los torneos. Ahora distingue: **Nacional/Panamericano** → cruces (oct/cua/semi) 3/1, final 5/2; **Departamental** → cruces 5/1, final 7/2. Usa el flag `esNacional` de `getCircuitInfo` (que ya cubre nacional + panamericano). Esto corrige el bug que sumó 5 puntos de más a un ganador de cuartos del Panamericano.

7. **Página Cruces reconoce Panamericano** (`CrucesPage.tsx`): `handleCircuitChange` chequeaba solo `cfg.tipo === 'nacional'`, dejando a panamericano en la rama departamental (filtros y labels mal). Ahora `esNac = tipo === 'nacional' || tipo === 'panamericano'`. Con esto el filtro de bracket, el badge y el botón de regenerar bracket funcionan en Panamericano.
   - Además se renombró el circuit 31 de "Etapa de Series" a "Circuito 1" (el dropdown lista circuitos por `name`; el nombre viejo confundía). `UPDATE "Circuit" SET name='Circuito 1' WHERE id=31`.

---

### COMPLETADO (27/06 — mañana) — Publicaciones Panamericano Categoría Máxima

Publicación `inicial-nacional` / `series-nacional` para Panamericano quedó 100% pulida en PNG export:

1. **Subtítulo**: "TORNEO PANAMERICANO" → reemplazado por "CATEGORÍA MÁXIMA" en el texto de fase (sirve para cualquier fase).
2. **Formato**: chip muestra "PARTIDAS A 5 SETS DE 60 TANTOS".
   - Backend `publicaciones.ts`: `formato: esPanamericano ? '5 sets de 60 tantos' : '3 sets de 60 tantos'` (en rama series-nacional/inicial-nacional).
3. **Banderas país** (URU/ARG/BRA): constantes `FLAG_URU_B64`, `FLAG_ARG_B64`, `FLAG_BRA_B64` (data:image/png;base64) junto al badge de país.
4. **Logo CPB** en header Panamericano (constante `LOGO_CPB_B64`).
5. **Ajustes export PNG** (html-to-image) en `AdminPublicacionesPage.tsx`:
   - Chip formato: `minWidth:340` + `textAlign:center` + `boxSizing:border-box`, fontSize 13, letterSpacing 0.08em (el ancho fijo evita el desborde del texto largo).
   - Chip SERIE: padding `'4px 28px 4px 18px'`, fontSize 16, letterSpacing 0.04em (número entra dentro del recuadro dorado).
   - Label partidos: "PARTIDO 1" / "PARTIDO 2" (sin "P1 ·" / "P2 ·"), con `whiteSpace:nowrap` (una sola línea).

### RESUELTO — bug "SERIE" cortado (era prioridad máxima)

El texto "SERIE" ya no se corta. Fix aplicado: color sólido (GOLDB) en vez de gradient text con `WebkitBackgroundClip:'text'`. Todas las plantillas de series renderizan bien en PNG.

---

### PENDIENTE — Replicar a categorías restantes del Panamericano

Categoría Máxima (Máster) ya está 100%. Faltan **Segunda, Tercera, Juvenil y Femenino** (cada una es un torneo/circuito SEPARADO dentro del Panamericano, con su propio circuitId).

Estado del mecanismo:
1. ✅ **Subtítulo dinámico del Bracket RESUELTO** — `PlantillaBracketNacional` ya deriva la categoría de `data.torneo`+`data.circuito` sin acentos. Funciona automáticamente para cualquier categoría cuyo nombre de torneo/circuito contenga la palabra clave (segunda/tercera/juvenil/femenino/máster). **Solo verificar** que los nombres de torneo/circuito de Segunda/Tercera/Juvenil/Femenino contengan la palabra de la categoría, o no matcheará (caería en "Bracket Final" pelado).
2. ✅ **Banderas en bracket** aplican automáticamente (mismo render compartido, condicionadas a `data.esPanamericano`).
3. ⚠️ **Subtítulo de publicaciones series/inicial** (texto de fase "CATEGORÍA MÁXIMA"): este SÍ sigue fijo, hay que hacerlo dinámico igual que el del bracket cuando se carguen las otras categorías.
4. Confirmar formato (5 sets / 60 tantos) por categoría — verificar si alguna usa otro.
5. Cargar jugadores, series y configTorneo (`tipo:panamericano`, `formato:16`) de cada categoría nueva.

Ver prompt preparado en sesión 27/06.

---

### OTROS PENDIENTES

- PNG export en publicaciones: monitorear que no reaparezcan cortes al cambiar textos.
- Mesas liberación: `UPDATE "Table" SET "status"='libre' WHERE id IN (60,61,62,63,64,65)`

---

## REGLAS CRITICAS

- NUNCA POST /circuits/:id/reset (borra partidos). Usar DELETE /rankings/limpiar/:circuitId
- Railway: una sentencia SQL a la vez (sin LIMIT en subqueries)
- new Set<number>() error TS → const s: Set<number> = new Set()
- acumulado.ts es directorio → usar rankingAcumulado.ts
- Archivos >2000 lineas (AdminPublicacionesPage.tsx ~2090): proveer completo para descarga, NO editar por GitHub web
- **Panamericano = nacional deportivamente**: en backend, las ramas que filtran por tipo deben aceptar `'nacional' || 'panamericano'`. Series usan prefijo `nac-serie-*`.
- **Si una serie nacional/panamericana queda con slot sin resolver** (placeholder "Per. SX-PY" con playerId null): correr `POST /matches/trigger-reparar-series/:phaseId`.

*Actualizado 29/06/2026 (noche) — Flujo de entrada del público + PWA: manifest `start_url`/`scope` → `/publico` (+ `id:/publico`), `sw.js` CACHE_NAME → v3 (precache `/publico`), raíz `/` sin login redirige a `/publico` (App.tsx, sin ProtectedRoute), link "Ver torneo sin login" removido del LoginPage. Selector de torneos de `/publico` ahora deriva de `allMatches` (cualquier torneo active, sin depender del nombre) — sin verificar en vivo (no había partidos asignados). PUBLIC_BUILD pub-public-2026-06-29-selector-allmatches. Pendiente próximo chat: rediseño vista de mesas. (Sesión previa 29/06: selector de torneo con 3 columnas filtradas, apócope Panamericano, control vía Tournament.active. 28/06 noche 2: subtítulo dinámico, Segunda bordeaux #6B2737, Fixture abre en activo.)*
