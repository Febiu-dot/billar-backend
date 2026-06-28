# PROJECT_STATUS.md
## Sistema FEBIU — Estado actual

---

## IDs CLAVE

| Recurso | ID |
|---|---|
| Torneo Nacional de Primera | tournamentId=19 |
| C1 Nacional de Primera | circuitId=29 |
| C2 Nacional de Primera | circuitId=27 |
| Torneo Panamericano de Primera | tournamentId=21 |
| C1 Panamericano de Primera | circuitId=31, phaseId=84 |
| Willy Billar Club | venueId=25, tableIds 60–65 |

---

## ESTADO AL 28/06/2026

### COMPLETADO (28/06) — Publicación Bracket de 8 + Ranking país/bandera (circuit 31)

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

Categoría Máxima ya está. Faltan **Segunda, Tercera, Juvenil y Femenino** (cada una es un torneo/circuito SEPARADO dentro del Panamericano, con su propio circuitId).

Objetivo:
1. Subtítulo dinámico por categoría ("SEGUNDA", "TERCERA", "JUVENIL", "FEMENINO") en vez de "CATEGORÍA MÁXIMA" fijo. Definir de dónde sale el dato (configTorneo / nombre del torneo / campo nuevo).
2. Confirmar formato (5 sets / 60 tantos) por categoría — verificar si alguna usa otro.
3. Validar que banderas, logo CPB y ajustes PNG aplican automáticamente (mismo render compartido).

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

*Actualizado 28/06/2026 — Bracket de 8 (regenerar con formato 16) y ranking país+bandera en publicaciones; causa de ambos: datos/bundle viejo, no código. BUILD_TAG → pub-2026-06-28-pana*
