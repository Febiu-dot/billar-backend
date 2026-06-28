# PROMPT MAESTRO FEBIU — SISTEMA INTEGRAL DE GESTIÓN DE TORNEOS
## Última actualización: 28/06/2026

---

## REGLA OBLIGATORIA — LEER PRIMERO

**MODO EFICIENCIA:**
- No expliques tu razonamiento.
- No hagas resúmenes extensos.
- No repitas especificaciones ya definidas.
- No describas código que no fue modificado.
- Limita las respuestas a los cambios realizados.
- Si necesitas tomar una decisión técnica, hazla y continúa.
- Solo consulta si existe una ambigüedad que impida avanzar.

**NO SOY PROGRAMADOR.**

Necesito SIEMPRE:
- Archivos **completos** (nunca fragmentos)
- Instrucciones paso a paso ("qué hago yo")
- Links directos a GitHub para cada archivo
- Commits con mensaje claro
- Links de Railway y Vercel

**Reglas técnicas críticas:**
- ⚠️ `new Set<number>()` da error TS → usar `const s: Set<number> = new Set()`
- ⚠️ Railway NO ejecuta SQL directo de forma confiable → usar API o Railway Query con sentencias simples (no LIMIT en subqueries, no ROW_NUMBER en UPDATE)
- ⚠️ Railway: forzar **Redeploy manual** después de cada push si no redeploya solo
- ⚠️ Archivos siempre completos + link GitHub + commit
- ⚠️ Si hay error de Vercel → pedir el log completo antes de suponer
- ⚠️ Sin migraciones a menos que cambie el schema.prisma
- ⚠️ **Cambio de schema con columna nueva**: correr el `ALTER TABLE` en Railway ANTES de desplegar el código que la usa, o el servicio crashea al arrancar (seed).
- ⚠️ **GitHub**: antes de commitear, verificar con Ctrl+F que el cambio esté realmente en el archivo. La traducción automática del navegador corrompe el pegado.
- ⚠️ **NUNCA** usar `POST /circuits/:id/reset` — borra todos los partidos sin recuperación
- ⚠️ Usar `DELETE /rankings/limpiar/:circuitId` para limpiar rankings
- ⚠️ Service Worker puede bloquear el login → Application → Borrar datos de sitios → Ctrl+Shift+R
- ⚠️ Para desasignar mesa de un partido: SQL directo `UPDATE "Match" SET "tableId"=NULL, "status"='pendiente' WHERE id=X`
- ⚠️ `acumulado.ts` es un directorio → siempre usar `rankingAcumulado.ts`
- ⚠️ **Panamericano = nacional deportivamente**: toda rama backend que filtre por tipo debe aceptar `tipo === 'nacional' || tipo === 'panamericano'` (aplica en `rankings.ts` → `recalcular-stats` y `GET /final`, y en `matches.ts` → `PUT /:id/result`). También en frontend: `RankingFinalPage.tsx` y `CrucesPage.tsx` detectan `esNac` con el mismo OR. Series del Panamericano usan prefijo `nac-serie-*`.
- ⚠️ **Slot sin resolver en serie** (placeholder "Per. SX-PY" con playerId null pese a estar finalizado): la propagación depende del orden de carga. Reparar con `POST /matches/trigger-reparar-series/:phaseId`.

---

## INFRAESTRUCTURA

| Componente | Tecnología | URL / Repo |
|---|---|---|
| **Backend** | TypeScript + Prisma + Express | https://github.com/Febiu-dot/billar-backend |
| **Frontend** | React + TypeScript + Vite + Tailwind | https://github.com/Febiu-dot/billar-frontend |
| **Base de Datos** | PostgreSQL | Railway (internal) |
| **Deploy Backend** | Railway | https://railway.app/dashboard |
| **Deploy Frontend** | Vercel | https://vercel.com/dashboard |
| **App pública** | — | https://billar-frontend-blue.vercel.app |
| **Admin URL** | — | https://billar-frontend-blue.vercel.app/admin |

**Backend URL:** `https://web-production-5d9da.up.railway.app`

---

## IDs IMPORTANTES EN DB

| Dato | ID |
|---|---|
| Jugador LIBRE | id=429, dni=FEBIU000 |
| Torneo Nacional de Primera | tournamentId=19 |
| C1 Nacional de Primera | circuitId=29 |
| C2 Nacional de Primera | circuitId=27 |
| Fase Series C1 | phaseId=82 (type=clasificatorio) |
| Fase Cruces C1 | phaseId=81 (type=master) |
| Fase Series C2 | phaseId=75 (type=clasificatorio) |
| Torneo Panamericano de Primera | tournamentId=21 |
| C1 Panamericano de Primera | circuitId=31, phaseId=84 |
| Willy Billar Club | venueId=25, tableIds 60–65 |
| RuleSet Series 5×60 (nacional primera) | id=2 |

---

## ESTRUCTURA DE RUTAS BACKEND (`src/routes/`)

| Archivo | Ruta base | Descripción |
|---|---|---|
| `auth.ts` | `/api/auth` | Login (case-insensitive, trim) |
| `tournaments.ts` | `/api/tournaments` | Torneos + circuitos + fases (cascade delete) |
| `circuits.ts` | `/api/circuits` | Circuitos, jugadores, ranking, generate, reset |
| `matches.ts` | `/api/matches` | Partidos, resultados, propagación, edición |
| `players.ts` | `/api/players` | Jugadores (incluye campo `pais`) |
| `users.ts` | `/api/users` | Jueces admin |
| `venues.ts` | `/api/venues` | Sedes y mesas |
| `rankings.ts` | `/api/rankings` | Rankings por circuito |
| `publicaciones.ts` | `/api/publicaciones` | Publicaciones gráficas |
| `rankingAcumulado.ts` | `/api/acumulado` | Ranking acumulado entre circuitos |

---

## ESTRUCTURA DE PÁGINAS FRONTEND (`src/pages/`)

| Archivo | Ruta | Descripción |
|---|---|---|
| `LoginPage.tsx` | `/login` | Login |
| `AdminDashboard.tsx` | `/admin` | Panel principal |
| `FixturePage.tsx` | `/admin/fixture` | Gestión torneos/circuitos/fases/partidos · auto-expande circuito activo |
| `MatchesPage.tsx` | `/admin/partidos` | Partidos con filtro, carga y edición de resultados |
| `PlayersPage.tsx` | `/admin/jugadores` | Gestión de jugadores · columna y selector País |
| `RankingFinalPage.tsx` | `/admin/ranking-final` | Ranking del circuito · botón 🔄 Aplicar Criterio Oficial · en Panamericano: columna País (apócope) en vez de Club y sin columna Categoría |
| `PublicPage.tsx` | `/publico` | Vista pública: mesas, partidos en curso, próximos, últimos resultados |
| `CrucesPage.tsx` | `/admin/cruces` | Asignación de mesa/fecha a cruces (reducción/primera/master/bracket) · reconoce nacional + panamericano |
| `ConfigTorneoPage.tsx` | `/admin/config-torneo` | Configurar tipo (Departamental/Nacional/Panamericano) |
| `AdminPublicacionesPage.tsx` | `/admin/publicaciones` | Publicaciones gráficas + export PNG |
| `UsersPage.tsx` | `/admin/usuarios` | Gestión de jueces |
| `JudgePage.tsx` | `/juez` | Panel juez (carga resultados) |

---

## SCHEMA PRISMA — MODELOS CLAVE

- **Player**: id, firstName, lastName, dni (unique), categoryId, club, **pais (String? @default("Uruguay"))**, departamentoId, active
- **Category**: name (enum: master | primera | segunda | tercera)
- **Tournament**: id, name, year, active, departamentoId, circuits[]
- **Circuit**: id, name, tournamentId, order, startDate, endDate, **configTorneo (Json)**, phases[]
- **CircuitPlayer**: circuitId, playerId — `@@unique([circuitId, playerId])`
- **Phase**: id, name, type (enum: clasificatorio | segunda | primera | master), circuitId, order
- **Match**: id, phaseId, playerAId, playerBId, slotA, slotB, tableId, ruleSetId, status, round, serieId, scheduledAt, result, sets[]
- **MatchResult**: matchId (unique), setsA, setsB, pointsA, pointsB, winnerId, isWO, woPlayerId
- **RankingEntry**: playerId, circuitId, points, matchesPlayed, matchesWon, setsWon, setsLost, pointsFor, pointsAgainst, position — `@@unique([playerId, circuitId])`
- **RankingAcumulado**: playerId, tournamentId, position, points, setsWon, setsLost, pointsFor, pointsAgainst, matchesPlayed, matchesWon, lastCircuitOrder, circuitosIncluidos — `@@unique([playerId, tournamentId])`
- **RuleSet**: id, name, bestOf, setsToWin, pointsPerSet, woSets…
- **Table**: id, number, venueId, status (libre | ocupada | fuera_de_servicio)

---

## CAMPO PAÍS (Player.pais)

- Tipo: `String? @default("Uruguay")` — opcional, adicional al departamento.
- SQL aplicado: `ALTER TABLE "Player" ADD COLUMN "pais" TEXT DEFAULT 'Uruguay';`
- Backend `players.ts`: lee/escribe `pais` en POST, PUT y bulk.
- Frontend `PlayersPage.tsx`: columna "Pais" en tabla + selector en formulario.
- Lista de países: Uruguay, Argentina, Brasil, Paraguay, Chile, Bolivia, Peru, Colombia, Ecuador, Venezuela, Mexico, Espana, Otro.
- Tipo frontend `Player` con `pais?: string`.
- **Relevante para Panamericano:** el campo `pais` se usa para mostrar apócope (URU/ARG/BRA) en publicaciones.

---

## FORMATO NACIONAL / PANAMERICANO

### Etapa de Series (Clasificatorio)
- 32 jugadores → 8 series × 4 jugadores, armado por espejo
- **5 partidos por serie:** P1(AvB) · P2(CvD) · P3(G1vG2)=1° · P4(P1vP2)=4° · P5(P3vG4)=2°/3°
- Total: **40 partidos**
- Puntuación: **1°=8 · 2°=6 · 3°=4 · 4°=2**
- Clasifican los primeros **16** del ranking a Cruces

### Formato 16 (Panamericano)
- 16 jugadores → 4 series × 4 jugadores → bracket de 8
- Total: **27 partidos** (20 series + 7 bracket)
- Bracket arranca en cuartos: cua-1=#1v8, cua-2=#4v5, cua-3=#3v6, cua-4=#2v7

### Etapa de Cruces (Bracket Master)
- serieIds: `nac-oct-1..8`, `nac-cua-1..4`, `nac-semi-1..2`, `nac-final`
- Puntuación cruces Nacional/Panamericano: ganador **3** / perdedor **1** · Final: ganador **5** / perdedor **2**
- Puntuación cruces Departamental (Primera/Master): ganador **5** / perdedor **1** · Final Master: ganador **7** / perdedor **2**
- ⚠️ Implementado en `matches.ts` → `asignarPuntosCruce`, condicional por flag `esNacional` de `getCircuitInfo`. NO usar valores planos: el cálculo distingue por tipo de torneo.

---

## CRITERIO DE DESEMPATE (CRITERIO OFICIAL FEBIU)

1. **Puntos**
2. **Diferencia de sets** = setsWon − setsLost
3. **Promedio de tantos** = pointsFor / pointsAgainst

---

## PUBLICACIONES

### Detección de tipo en frontend (AdminPublicacionesPage.tsx)
```typescript
// Detecta si el circuito es de tipo nacional O panamericano
const esNac = /nacional/i.test(circ?.torneoNombre ?? '') || /panamericano/i.test(circ?.torneoNombre ?? '');
```

### Publicaciones nacionales/panamericanas
| Valor | Label |
|---|---|
| `inicial-nacional` | 📋 Inicial (fixture sin resultados) |
| `series-nacional` | 🎱 Series Nacional (con resultados) |
| `ranking` | 🏅 Ranking del Circuito |
| `cruces-nacional` | ⚔️ Cruces Nacional |
| `bracket-nacional` | 🏟 Bracket Nacional |
| `ranking-acumulado-nacional` | 🏆 Ranking Final |

### Panamericano — apócope de país
- El backend `publicaciones.ts` detecta `esPanamericano` leyendo `circuit.configTorneo.tipo === 'panamericano'`
- Envía `esPanamericano: true/false` en el response
- El frontend `AdminPublicacionesPage.tsx` usa `badgeJugador()` en `mkRow`:
  - Si `data.esPanamericano` → muestra `apocPaisFE(jugador.pais)` (URU/ARG/BRA/etc.)
  - Si no → muestra `jugador.club` (comportamiento original)
- Dict de apócopes: Uruguay→URU, Argentina→ARG, Brasil→BRA, Paraguay→PAR, Chile→CHI, Bolivia→BOL, Peru→PER, Colombia→COL, Venezuela→VEN, Ecuador→ECU
- **Tabla Ranking del Circuito** (`RankingFinalPage.tsx`): en Panamericano muestra País (apócope, mismo dict) en vez de Club y oculta la columna Categoría (la categoría la define el torneo: Máxima/Segunda/Juvenil/etc., cada uno circuito separado). El backend `GET /rankings/final` envía `pais` por jugador.

### Panamericano — subtítulo, formato y ajustes de export PNG (27/06)
- **Subtítulo**: en el texto de fase, "TORNEO PANAMERICANO" se reemplaza por la categoría. Categoría Máxima → "CATEGORÍA MÁXIMA". (Pendiente: dinámico para Segunda/Tercera/Juvenil/Femenino, cada una torneo/circuit separado.)
- **Formato (backend publicaciones.ts)**: en rama series-nacional/inicial-nacional → `formato: esPanamericano ? '5 sets de 60 tantos' : '3 sets de 60 tantos'`. El chip muestra "PARTIDAS A 5 SETS DE 60 TANTOS".
- **Logo CPB**: constante `LOGO_CPB_B64` (base64) en header Panamericano. Banderas: `FLAG_URU_B64 / FLAG_ARG_B64 / FLAG_BRA_B64` (data:image/png;base64) junto al badge de país.
- **Ajustes export PNG (html-to-image)** en AdminPublicacionesPage.tsx — claves para que no se corten textos:
  - Chip formato: `minWidth:340` + `textAlign:'center'` + `boxSizing:'border-box'`, fontSize 13, letterSpacing 0.08em. **El ancho fijo es lo que evita el desborde** (inline-block solo no alcanza con html-to-image).
  - Chip SERIE: padding `'4px 28px 4px 18px'`, fontSize 16, letterSpacing 0.04em (el letterSpacing alto empuja el último carácter fuera del padding → mantener bajo + padding derecho extra).
  - Label partidos: "PARTIDO 1/2" con `whiteSpace:'nowrap'` y `flexShrink:0` (una sola línea).

### Colores por categoría federal
| Categoría | bg | accent |
|---|---|---|
| primera | 🔵 navy/gold | #0a223f / #f4c430 |
| segunda | 🟠 marrón/gold | #2f1a0a / #f4c430 |
| tercera | 🟢 verde/gold | #0a2f1a / #f4c430 |

---

## ENDPOINTS CLAVE

- `PUT /matches/:id/result` — cargar/editar resultado. Si ya era finalizado, recalcula stats desde cero.
- `POST /matches/regenerar-bracket/:circuitId` — genera bracket espejo desde RankingEntry
- `POST /matches/trigger-reparar-series/:phaseId` — repara slots de series nacionales/panamericanas (P5.slotA=perdedor P3, P5.slotB=ganador P4) sin depender del orden de carga
- `GET /rankings/final?circuitId=X` — para nacionales/panamericanos lee de RankingEntry (incluye `pais` del jugador)
- `POST /rankings/recalcular-stats/:circuitId` — recalcula stats (filtra `nac-serie-*` para nacionales)
- `DELETE /rankings/limpiar/:circuitId` — limpia rankings (**usar en vez de /reset**)
- `GET /acumulado/:tournamentId` — ranking acumulado
- `GET /publicaciones/:circuitId/:tipoFase` — datos para publicación

---

## NOTAS TÉCNICAS

1. **TypeScript Sets**: siempre `const s: Set<number> = new Set()`.
2. **Railway SQL**: una sentencia a la vez. No LIMIT en subqueries de UPDATE.
3. **Vercel bundle viejo**: si un cambio no se ve, modificar algo real para cambiar el hash del chunk. Verificar con `data-build` en el DOM. La constante `BUILD_TAG` (en AdminPublicacionesPage.tsx) sirve justamente para esto: cambiarla fuerza chunk hash nuevo. Valor actual: `pub-2026-06-28-pana`.
4. **Service Worker**: si el login se cuelga → Application → Borrar datos de sitios → Ctrl+Shift+R.
5. **Mesas**: el backend NO actualiza `Table.status` automáticamente.
6. **recalcular-stats para nacionales**: filtra `serieId: { startsWith: 'nac-serie-' }`.
7. **Export PNG**: usa `html-to-image` (CDN v1.11.11). Emojis de bandera pueden fallar. Imágenes en `/public` con `crossOrigin="anonymous"`.

---

## ESTRUCTURA configTorneo (campo JSON en Circuit)

**Nacional:**
```json
{ "tipo": "nacional", "categoriaFederal": "primera", "ruleSetSeries": 2, "ruleSetCruces": 2 }
```

**Panamericano:**
```json
{ "tipo": "panamericano", "categoriaFederal": "primera", "formato": "16", "ruleSetSeries": 2, "ruleSetCruces": 2 }
```

**Departamental:**
```json
{ "tipo": "departamental", "cantMaster": 8, "cantPrimera": 24, "cantSegunda": 32, "cuposDesdeClasif": 16 }
```

---

*Sistema FEBIU v3.7 — Federación de Billar del Uruguay*
*Actualizado 28/06/2026 — Bracket de 8 (formato 16) y ranking país+bandera en publicaciones ya en código; bug era bundle viejo en Vercel (BUILD_TAG bumpeado a pub-2026-06-28-pana)*
