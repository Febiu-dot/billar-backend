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

## ESTADO AL 01/07/2026

### COMPLETADO (01/07) — Bug crítico de carga de sets con 2 jueces en paralelo (se pisaba el set anterior)

**Síntoma:** durante el Panamericano en curso, dos jueces cargando resultados a la vez. Un juez cargaba un set de un partido (apretando Guardar), pasaba a otro, y al volver al primero el set anterior "no se conservaba" en pantalla → los obligaba a cargar todo junto al final, matando el tiempo real del público.

**Causa:** el modal de resultado (`MatchesPage.tsx`) inicializaba los sets desde el objeto `match` de la lista renderizada. Con 2 jueces, los sockets (`match:updated` de cualquier mesa) refrescan la lista constantemente, así que al reabrir un partido el modal podía tomar un objeto **stale** (sin el último set guardado) → al guardar el siguiente set con `setNumber: index+1` sobre un array que arrancó vacío, se **pisaba** el set 1. (El set SÍ quedaba en la base; era un problema de recarga/desincronización del modal, no de persistencia.)

**Fix (solo frontend, `MatchesPage.tsx`):**
- `openResultModal` ahora es async y trae el partido **fresco del backend** (`GET /matches/:id`, que ya incluye `sets`) antes de armar el modal, en vez de confiar en el objeto de la lista. Fallback al objeto de lista si el fetch falla.
- `handleSaveSet`: tras `PUT /matches/:id/set`, re-sincroniza `sets` y `resultModal` desde la **respuesta del backend** (fuente de verdad), en vez del estado local. El endpoint `/set` ya devolvía el match completo con todos los sets.
- `BUILD_TAG = matches-2026-07-01-set-fresh-fetch`. Typecheck `tsc --noEmit` limpio.
- Tras deploy, los jueces deben **recargar una vez** (caché SW) para tomar el bundle. Los sets ya cargados antes del fix estaban guardados en la base (no se perdió nada). ⚠️ Pendiente de verificar en el torneo de prueba (no se pudo probar en vivo por estar los partidos reales en curso). Si tras el deploy aún se pierde algún set, la segunda capa a revisar es el `upsert` por `setNumber` en el backend (`PUT /:id/set`, matches.ts ~872).

### COMPLETADO (01/07) — Vista de mesas en /publico: sin modal ni frase de "tocar para ver detalle"

Durante el Panamericano de Tercera se detectó que las tarjetas de mesa (que ya muestran jugadores, categoría y marcador en vivo) tenían: (a) una frase "Tocá una mesa en juego para ver el detalle del partido" innecesaria, y (b) al tocar la mesa abría un modal con historial que mostraba partidos viejos de Nacionales (por serieId reutilizado / datos residuales). Cambio (`PublicPage.tsx`):
- Eliminada la frase.
- Las tarjetas de mesa ya NO son clickeables (quitado `onClick={handleMesaClick}` y el `cursor-pointer hover:bg-orange/10`).
- Eliminados por completo la función `handleMesaClick`, el estado `mesaModal`/`setMesaModal` y todo el bloque JSX del modal de mesa. Typecheck limpio.
- El detalle en vivo dentro de cada tarjeta se conserva intacto.
- `PUBLIC_BUILD = pub-public-2026-07-01-mesas-sin-modal`.

### COMPLETADO (01/07) — Selectores de torneo del admin (Fixture y Partidos) filtran solo torneos activos

Los modales/selectores de torneo en `/admin/fixture` (`FixturePage.tsx`) y `/admin/partidos` (`MatchesPage.tsx`) cargaban **todos** los torneos con `GET /tournaments` sin filtrar, así que los Nacionales finalizados seguían apareciendo y estorbaban al trabajar en el Panamericano. Cambio (solo frontend):
- Ambos ahora filtran `r.data.filter(t => t.active)` → el selector muestra solo torneos con `active = true`. En `FixturePage` la auto-selección inicial toma el primer activo (`activos[0]`).
- **No se borra nada**: los Nacionales quedan en la base con su historial; solo se ocultan de los selectores mientras estén en `active = false`. Para volver a verlos/editarlos: `UPDATE "Tournament" SET active = true WHERE id = ...`, trabajar, y volver a desactivar.
- Marcadores de build agregados al tope de cada archivo: `// BUILD_TAG = fixture-2026-07-01-solo-activos` y `// BUILD_TAG = matches-2026-07-01-solo-activos`.
- Mismo mecanismo que ya se usa en la Vista Pública y para ocultar Juvenil (torneo 24) / Femenino (torneo 25). Requisito: los torneos a ocultar deben estar en `active = false`.

### COMPLETADO (30/06) — Vista de mesas por torneo en /publico + sustitución de provisorios "Qualy" sin perder mesa/horario

**1. Vista de MESAS de `/publico` rediseñada y filtrada por torneo** (`PublicPage.tsx`, `PUBLIC_BUILD = pub-public-2026-06-30-mesas-por-torneo`). Antes "Estado de Mesas" cargaba TODAS las mesas de TODAS las sedes (`GET /tables` sin filtro), en botones chicos (grilla 9) que solo mostraban número + 1ª palabra de la sede + puntito de color; el detalle requería abrir el modal. Cambios (solo frontend):
- **Mesas filtradas por el torneo elegido**, derivadas de los partidos (`allMatches`), NO por venueId fijo: una mesa entra si tiene ≥1 partido (cualquier estado) del `torneoSel`. Para el Panamericano quedan exactamente las 6 de Willy (tableIds 60–65). Robusto ante cambio de sede. Antes de elegir torneo → mensaje "Elegí un torneo…"; torneo sin mesas → "Este torneo no tiene mesas asignadas todavía".
- **Tarjetas anchas** (1 col mobile / 2 desktop) en vez de botones: barra superior con número + sede + estado (En juego/Libre/Fuera de servicio, color verde/naranja/rojo, punto pulsante si en juego) y, si está en juego, en la propia portada: torneo · categoría (`phase.circuit.tournament.name` · `phase.name`), ambos jugadores (con apócope de país solo en Panamericano vía `nombrePublico`/`matchEsPana`), sets grandes (`result.setsA—setsB`) y puntos del set actual (`pointsA—pointsB`). El modal `mesaModal` se conserva como "ver detalle" al tocar una mesa en juego.
- Helpers nuevos en el componente: `mesasTorneo` (deriva y ordena por `number`) y `matchEnMesaDe(tableId)`.

**2. Sustitución de jugador provisorio "Qualy" por el real, SIN perder mesa ni horario** (backend `matches.ts` + frontend `MatchesPage.tsx`). Caso: la etapa de series tiene partidos ya generados (con mesa/hora por asignar) donde varios puestos son provisorios porque salen de un torneo Qualy previo. Los "Qualy Uno/Dos/…" están cargados como **jugadores reales** en `Player` (no como `slotA`/`slotB`; si fueran slot vacío no se armaban las series).
- **Backend — endpoint nuevo `PUT /matches/:id/jugador`** (solo admin). Body `{ lado: 'A'|'B', playerId }`. Setea `playerAId`/`playerBId` y limpia `slotA`/`slotB`; `playerId` null vacía el lugar (opcional `slotLabel` para reponer texto). NO toca `tableId`, `scheduledAt`, `phaseId` ni `serieId`. Reutiliza el `include` estándar + `emitMatchUpdate`. Insertado antes de `PUT /:id/assign`.
- **Frontend — lápiz ✏️ de sustitución** en `/admin/partidos`. Aparece sobre **ambos** jugadores en partidos `pendiente` o `asignado` (sea provisorio o real). Nombres tipo "Qualy" se muestran en naranja. Modal con `<select>` de todos los jugadores activos (orden apellido) que llama al endpoint; tras éxito refresca. Estados nuevos: `subModal`/`subPlayers`/`subSelected`/`subSaving`; funciones `openSubModal`/`handleSustituir`. El render de jugadores se reescribió con helper inline `renderLado('A'|'B')`.
- ⚠️ El helper `playerName` muestra `—` cuando no hay jugador real e **ignora** `slotA/slotB`; por eso en partidos con lugar vacío de verdad se ve "—". Con los Qualy como Player real, el nombre se ve normal y el ✏️ permite cambiarlo.

**3. Limpieza de residuos del simulacro Panamericano Máxima (circuit 31 / torneo 21).** Tras los simulacros quedaron datos viejos que se veían en la vista pública: 20 filas en `RankingEntry` (pestaña "Clasificados") y 16 en `RankingAcumulado` (pestaña "Ranking Final"), pese a que las series reales aún no se jugaron. Los partidos de series e inscriptos reales SÍ debían conservarse. Por eso NO se usó `DELETE /rankings/limpiar/31` (ese endpoint borra también partidos/inscriptos). Limpieza por SQL puntual, una sentencia por vez en Railway, que NO toca partidos ni inscriptos:
- `DELETE FROM "RankingEntry" WHERE "circuitId" = 31;` (borró 20)
- `DELETE FROM "RankingAcumulado" WHERE "tournamentId" = 21;` (borró 16)
Resultado: ambas pestañas desaparecen de `/publico` (el frontend oculta "Ranking Final" si el acumulado viene vacío). Clasificados se recalcula solo desde los resultados cuando se jueguen las series. El Ranking Final se regenera con `POST /acumulado/calcular/21`.
- ⚠️ **Regla**: para vaciar SOLO el ranking de un circuito Nacional/Panamericano SIN borrar sus partidos, usar `DELETE FROM "RankingEntry" WHERE "circuitId"=X` por SQL. El endpoint `DELETE /rankings/limpiar/:circuitId` borra ranking + partidos + inscriptos (sirve para descartar un circuito entero, NO para limpiar residuo conservando el fixture).

**4. Formato de la tabla inicial/series dinámico desde el RuleSet real** (`publicaciones.ts`, rama `inicial-nacional`/`series-nacional`). El chip "PARTIDAS A 5 SETS DE 60 TANTOS" estaba **hardcodeado**: `formato: esPanamericano ? '5 sets de 60 tantos' : '3 sets de 60 tantos'` → asumía 5 sets para TODO Panamericano. Segunda y Tercera (guardadas en 3 sets) salían mal con "5 sets". Fix: el texto se construye desde el `RuleSet` apuntado por `config.ruleSetSeries` del circuito → `${rs.bestOf} sets de ${rs.pointsPerSet} tantos`. Fallback al texto previo si no hay `ruleSetSeries`. Solo backend; el frontend `AdminPublicacionesPage.tsx` ya usaba `data.formato` (no era fijo). El texto ahora refleja EXACTO lo guardado en el RuleSet de series de cada circuito; si una categoría muestra un nº de sets inesperado, corregir su `ruleSetSeries`/RuleSet en la config, no el código.

**5. Anular asignación de mesa ("Quitar mesa")** (backend `matches.ts` + frontend `MatchesPage.tsx`). No existía forma de deshacer una asignación de mesa hecha por error; había que ir por SQL. Ahora:
- **Backend — endpoint nuevo `PUT /matches/:id/desasignar`** (admin/juez_sede). Deja el partido `pendiente` con `tableId: null` y libera la mesa (`status: 'libre'`) SOLO si no quedó otro partido `asignado`/`en_juego` ocupándola. Bloquea (409) si el partido está `en_juego` o `finalizado`. No borra el partido. Reutiliza `include` estándar + `emitMatchUpdate`/`emitTableUpdate`. Insertado después de `PUT /:id/assign`.
- **Frontend — botón "Quitar mesa"** junto a "▶ Iniciar" en partidos con estado `asignado` en `/admin/partidos`. Pide confirmación, llama al endpoint y refresca. Función `handleDesasignar`.



### COMPLETADO (29/06 — noche tardía) — configTorneo de categorías Panamericano + título/subtítulo de publicaciones + DNI duplicado

**1. `configTorneo` faltante en las categorías nuevas del Panamericano (causa de "vista previa departamental").** Al replicar el Panamericano a Segunda/Tercera/Juvenil/Femenino desde el Fixture, los circuitos quedaron con `configTorneo` **vacío**. Sin `tipo`, `getConfigTorneo` asume `'departamental'` → `esNacional(config)` da false → la generación arma el esquema departamental (Máster/Primera/Segunda/Clasif con cupos: "8 MÁSTER, 8 PRIMERA…") en vez de **series clasificatorias + bracket**. Síntoma adicional: si se genera igual, los partidos van a fase `master` (serieId `master-cruce-*`) y Publicaciones → "Inicial" da "No hay partidos de series nacionales generados" (esa publicación busca fase `clasificatorio` con `serieId` no nulo).

**Solución:** setear `configTorneo` por SQL clonando el de Máxima (circuit 31): `{"tipo":"panamericano","formato":"16","categoriaFederal":"<cat>","ruleSetSeries":1,"ruleSetCruces":2,"cantMaster":0,"cantPrimera":0,"cantSegunda":0,"cuposDesdeClasif":0}`. Aplicado a circuit 32 (Segunda, cat "segunda") ✓ y preparado para 33/34/35. Para Juvenil y Femenino `categoriaFederal` se dejó en `"tercera"` (el enum solo admite primera/segunda/tercera; no afecta porque las reglas las fijan los `ruleSet*` guardados, y el subtítulo/paleta salen del nombre del circuito). Tras el UPDATE: en el Fixture, "Limpiar" si se generó bracket por error, luego "Generar partidos" → vista previa correcta (4 series + bracket 16).

- **Confirmado mecanismo de reglas:** al generar (circuits.ts ~604), `ruleSetSeries = config.ruleSetSeries ?? getRuleSetNacional(...)` → los valores guardados en `configTorneo` MANDAN sobre la regla por categoría. RuleSet 1 = "Series (mejor de 3)" (bestOf 3, 2 sets, 60 tantos); RuleSet 2 = "Cruces (mejor de 5)" (bestOf 5, 3 sets, 60 tantos). Todas las categorías del Panamericano usan series=1, cruces=2.
- ⚠️ **Dato curioso (no es bug):** circuit 31 (Máxima/Máster) tiene `categoriaFederal: "segunda"` en su config. No afecta nada porque `categoriaFederal` no se usa para paleta/subtítulo (esos salen del nombre del circuito).

**2. Título/subtítulo de publicaciones Panamericano — independientes del nombre del torneo** (`AdminPublicacionesPage.tsx`, descarga completa ~2200 líneas, BUILD_TAG `pub-2026-06-29-subtitulo-limpio`). El usuario identifica los torneos en el Fixture (ej. "TORNEO PANAMERICANO Cat. Máx") y ese texto se colaba en la publicación (título "...1" desbordado a 2ª línea; subtítulo "CATEGORÍA MÁXIMA Cat. Máx"). Fixes:
- **Título** (`PubHeader` moderno ~244 y departamental ~290): `{data.esPanamericano ? 'TORNEO PANAMERICANO' : data.torneo}` → fijo en Panamericano. (Bracket ~1592 ya lo hacía.)
- **Subtítulo** (`faseMostrar`): antes `data.fase.replace(/TORNEO PANAMERICANO/gi, catSubtitulo)` dejaba residuo. Ahora reconstruye: toma el prefijo antes del "—" de `data.fase` y le pega `catSubtitulo` → "FIXTURE INICIAL — CATEGORÍA MÁXIMA" limpio.
- Categoría se deriva de `norm(data.torneo)+norm(data.circuito)`; el **circuito** debe contener la palabra de categoría.

**3. Inscripción circuit 31 — faltaba 1 inscripto (15/16).** Causa: **DNI duplicado** en `Player` → la carga del Excel hace `findFirst` por DNI; dos filas resolvían al mismo jugador, el `upsert` solo actualizaba (no creaba inscripto). Reportaba "16 cargados" (cuenta filas) pero 15 `CircuitPlayer`. Detección: faltaba la posición 1 en `RankingEntry`. Resuelto corrigiendo el DNI en `Player` y recargando → 16/16.

### COMPLETADO (29/06 — noche) — Flujo de entrada del público + instalación PWA directa a `/publico` (sin login)

Antes, el público entraba por la **misma pantalla de login** (con un link chico "Ver torneo sin login"). Confuso. Resuelto para que la app instalada y la raíz abran DIRECTO en la Vista Pública sin pasar nunca por login. **Solo frontend, 4 archivos + bump:**

1. **`public/manifest.json`**: `start_url` y `scope` cambiados de `/` a **`/publico`** → la PWA instalada arranca en la Vista Pública. Agregado `"id": "/publico"` (evita que iOS/Android mezclen instalaciones viejas). Se quitó el shortcut "Panel Juez" (apuntaba fuera del nuevo scope; algunos navegadores lo descartan). Shortcut "Ver Torneo" → `/publico` queda.
2. **`public/sw.js`**: `CACHE_NAME` bumpeado `febiu-billar-v2` → **`v3`** (invalida SW viejo; el SW ya dio problemas de caché en este proyecto). `STATIC_ASSETS` precachea `/publico` en vez de `/`. Lógica navigate (network-first, fallback `index.html`) y assets (cache-first) sin cambios.
3. **`src/App.tsx`**: la raíz `/` ya NO usa `ProtectedRoute` (que mandaba a `/login`). Ahora redirige por rol: admin→`/admin`, juez→`/juez`, **sin sesión→`/publico`**. Las rutas admin/juez siguen protegidas igual; `ProtectedRoute` sigue en uso. Catch-all `*` va a `/` (que ahora resuelve a público).
4. **`src/pages/LoginPage.tsx`**: removido el bloque del link "Ver torneo sin login →" (el público ya no pasa por login).
- `PublicPage.tsx` → `PUBLIC_BUILD = pub-public-2026-06-29-pwa-publico` (luego bumpeado de nuevo, ver punto siguiente).

**Link para el público / QR:** `https://billar-frontend-blue.vercel.app/publico` → abre directo, e instalado arranca en `/publico`. Para reinstalar limpio: desinstalar PWA vieja, cerrar navegador, reabrir `/publico`, instalar (Android: menú → Agregar a pantalla principal; iPhone: Compartir → Agregar a inicio).

**Ajuste selector de torneos (mismo día):** el selector superior de `/publico` derivaba `torneosActivos` solo de las 3 listas filtradas (en juego/pendiente/finalizado); un torneo `active` sin partidos en esas listas no aparecía. Cambiado para derivar de **`allMatches`** (todos los partidos sin importar estado), filtrando `tournament.active === true`, sin depender del nombre. `PUBLIC_BUILD = pub-public-2026-06-29-selector-allmatches`. **Sin verificar en vivo aún** (no hay partidos asignados al cierre de la sesión). ⚠️ Si tras asignar partidos el selector sigue vacío, revisar que `GET /matches` (sin filtro) popule la cadena `phase → circuit → tournament` en el `include`.

**~~PENDIENTE~~ RESUELTO (30/06):** rediseño de la **vista de MESAS** en `/publico` — ver bloque "ESTADO AL 30/06/2026" arriba (filtrada por torneo + tarjetas con jugadores/marcador).

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

- **Pantalla de entrada única en la PWA instalada (mejora post-Panamericano).** Hoy la app instalada ("FBU Torneos") abre directo en `/publico` (start_url), pensada para el público → un juez con credenciales NO puede loguearse desde el ícono: tiene que ir manualmente a `/login`. Se quiere que la app instalada tenga UNA puerta que sirva para todos: el público ve el torneo sin login y el que tiene credenciales entra a su panel (juez/admin). Como el público no tiene contraseña, mostrar el acceso a login no da acceso a nada. Opciones a evaluar: (a) pantalla de entrada con dos botones "Ver torneo" / "Ingresar" ; (b) mantener start_url `/publico` pero con un acceso a login visible desde ahí; (c) que si el usuario YA está logueado, la raíz lo lleve a su panel. Muy útil para reutilizar en cualquier torneo cuando cambien sedes y jueces. NO tocar durante un torneo en vivo: implementar con calma y probar en el torneo de prueba. Afecta ruteo (`App.tsx`, raíz `/`, `/login`, `/publico`) y quizá el manifest.
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
- **Provisorios "Qualy" = jugadores reales en `Player`** (no slots de texto). Sustituir por el real con `PUT /matches/:id/jugador` desde el ✏️ en `/admin/partidos` (conserva mesa y horario).
- **Vista de mesas de `/publico` filtra por torneo elegido** (deriva de `allMatches`, no de `GET /tables` ni de venueId fijo). Una mesa sin partidos del torneo no aparece.

*Actualizado 01/07/2026 (pendiente) — Agregado a OTROS PENDIENTES: pantalla de entrada única en la PWA instalada (que sirva para público y para juez/admin con credenciales, sin tener que ir a /login a mano). Mejora post-Panamericano, no tocar en torneo en vivo.*

*Actualizado 01/07/2026 (sets) — Fix bug crítico: con 2 jueces cargando en paralelo, el modal de resultado abría con un match stale de la lista (refrescada por sockets) y al guardar pisaba el set anterior. openResultModal ahora trae el partido fresco por GET /matches/:id y handleSaveSet re-sincroniza sets desde la respuesta del backend. BUILD_TAG matches-2026-07-01-set-fresh-fetch. Los jueces deben recargar 1 vez. Pendiente verificar en torneo de prueba.*

*Actualizado 01/07/2026 (mesas) — Vista de mesas de /publico: eliminada la frase "tocá una mesa para ver detalle", las tarjetas ya no son clickeables y se removió por completo el modal de mesa (mostraba historial residual de Nacionales por serieId). El detalle en vivo dentro de la tarjeta se conserva. PUBLIC_BUILD pub-public-2026-07-01-mesas-sin-modal.*

*Actualizado 01/07/2026 — Selectores de torneo del admin (FixturePage y MatchesPage) ahora filtran solo torneos con active=true, para no ver los Nacionales finalizados mientras se trabaja en el Panamericano. No se borra nada: los inactivos quedan en la base con su historial y reaparecen si se reactivan (UPDATE Tournament SET active=true). BUILD_TAG fixture-2026-07-01-solo-activos / matches-2026-07-01-solo-activos. Mismo mecanismo active ya usado en Vista Pública y para ocultar Juvenil (torneo 24) / Femenino (torneo 25).*

*Actualizado 30/06/2026 — Vista de mesas de /publico filtrada por torneo (deriva de allMatches, no de GET /tables ni venueId fijo) + rediseño a tarjetas con jugadores/categoría/marcador en portada; modal conservado como detalle. PUBLIC_BUILD pub-public-2026-06-30-mesas-por-torneo. Endpoint nuevo PUT /matches/:id/jugador para sustituir provisorios "Qualy" (cargados como Player real) por el jugador real sin perder mesa/horario; lápiz ✏️ en /admin/partidos sobre jugadores de partidos pendiente/asignado. Limpieza de residuos del simulacro Pana Máxima por SQL puntual (DELETE RankingEntry circuit 31 = 20 filas, DELETE RankingAcumulado torneo 21 = 16 filas) SIN tocar partidos/inscriptos reales; regla nueva para limpiar ranking sin borrar fixture. Formato del chip de tabla inicial/series ahora dinámico desde el RuleSet real (config.ruleSetSeries) en publicaciones.ts, ya no hardcodeado a 5 sets para Panamericano (Segunda/Tercera salían mal; eran 3 sets). Endpoint nuevo PUT /matches/:id/desasignar + botón "Quitar mesa" en /admin/partidos para anular una asignación de mesa hecha por error (libera la mesa si no quedó otro partido ocupándola; bloquea si en juego/finalizado).*

*Actualizado 30/06/2026 (sesión TS) — Backend en **0 errores de TypeScript**. Había 77 errores TS7006 ("Parameter implicitly has an 'any' type") acumulados en `src/routes/circuits.ts` (7), `src/routes/matches.ts` (21), `src/routes/publicaciones.ts` (21), `src/routes/rankings.ts` (19), `src/routes/tournaments.ts` (1), `src/routes/users.ts` (1), `src/services/reportService.ts` (7). Solución: anotar cada parámetro de callback con `: any` explícito (p.ej. `.map(p => ...)` → `.map((p: any) => ...)`). Sin cambios de lógica ni comportamiento. `npx tsc --noEmit` confirma 0 errores.*

*Actualizado 29/06/2026 (noche tardía) — configTorneo faltante en categorías nuevas del Panamericano (Segunda/Tercera/Juvenil/Femenino quedaban en esquema departamental): setear por SQL clonando el de Máxima (tipo panamericano, formato 16, ruleSetSeries 1, ruleSetCruces 2). Publicaciones Panamericano: título fijo "TORNEO PANAMERICANO" + subtítulo reconstruido "<TIPO> — CATEGORÍA <X>", independientes del nombre del torneo. BUILD_TAG pub-2026-06-29-subtitulo-limpio. Regla nueva: DNI duplicado en carga de ranking pierde 1 inscripto. (Misma noche, antes: entrada del público + PWA → start_url/scope /publico, sw.js v3, raíz / sin login a /publico, link removido del LoginPage; selector de torneos desde allMatches. PUBLIC_BUILD pub-public-2026-06-29-selector-allmatches. Pendiente: rediseño vista de mesas.)*
