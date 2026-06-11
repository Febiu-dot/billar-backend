import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';

interface Tournament { id: number; name: string; }
interface Circuit    { id: number; name: string; tournamentId: number; order: number; }

interface RankingEntry {
  posicion:   number;
  playerId:   number;
  firstName:  string;
  lastName:   string;
  club:       string;
  categoria:  string;
  puntos:     number;
  setsGanados: number;
  tantos:     number;
  promedio:   number;
}

const CAT_COLORS: Record<string, string> = {
  master:  'bg-yellow-900/40 text-yellow-400 border border-yellow-700/30',
  primera: 'bg-blue-900/40 text-blue-400 border border-blue-700/30',
  segunda: 'bg-green-900/40 text-green-400 border border-green-700/30',
  tercera: 'bg-gray-800/40 text-gray-400 border border-gray-700/30',
};

const CAT_LABEL: Record<string, string> = {
  master:  'Máster',
  primera: 'Primera',
  segunda: 'Segunda',
  tercera: 'Tercera',
};

export default function RankingFinalPage() {
  const { user } = useAuth();

  const [tournaments, setTournaments]               = useState<Tournament[]>([]);
  const [circuits, setCircuits]                     = useState<Circuit[]>([]);
  const [selectedTournament, setSelectedTournament] = useState('');
  const [selectedCircuit, setSelectedCircuit]       = useState('');
  const [tournamentName, setTournamentName]         = useState('');
  const [circuitName, setCircuitName]               = useState('');
  const [esNacional, setEsNacional]                 = useState(false);

  const [ranking, setRanking]             = useState<RankingEntry[]>([]);
  const [loading, setLoading]             = useState(false);
  const [filtro, setFiltro]               = useState<string>('general');
  const [busqueda, setBusqueda]           = useState('');
  const [guardando, setGuardando]         = useState(false);
  const [guardadoMsg, setGuardadoMsg]     = useState('');
  const [generandoBracket, setGenerandoBracket] = useState(false);
  const [bracketMsg, setBracketMsg]       = useState('');
  const [iniciandoC2, setIniciandoC2]     = useState(false);
  const [iniciarC2Msg, setIniciarC2Msg]   = useState('');
  const [allCircuits, setAllCircuits]     = useState<Circuit[]>([]);
  const [recalculando, setRecalculando]   = useState(false);
  const [recalcularMsg, setRecalcularMsg] = useState('');

  useEffect(() => {
    api.get('/tournaments').then(r => setTournaments(r.data));
    api.get('/circuits').then(r => {
      setCircuits(r.data);
      setAllCircuits(r.data);
    });
  }, []);

  const circuitsFiltrados = selectedTournament
    ? circuits.filter(c => c.tournamentId === Number(selectedTournament)).sort((a, b) => a.order - b.order)
    : [];

  const handleTournamentChange = (tournamentId: string) => {
    setSelectedTournament(tournamentId);
    setSelectedCircuit('');
    setRanking([]);
    setGuardadoMsg(''); setBracketMsg(''); setRecalcularMsg('');
    const t = tournaments.find(t => t.id === Number(tournamentId));
    setTournamentName(t?.name ?? '');
  };

  const cargarRanking = (circuitId: string) => {
    setLoading(true);
    api.get(`/rankings/final?circuitId=${circuitId}`)
      .then(r => { setRanking(r.data); setFiltro('general'); })
      .catch(() => setRanking([]))
      .finally(() => setLoading(false));
  };

  const handleCircuitChange = async (circuitId: string) => {
    setSelectedCircuit(circuitId);
    setGuardadoMsg(''); setBracketMsg(''); setIniciarC2Msg(''); setRecalcularMsg('');
    const c = circuits.find(c => c.id === Number(circuitId));
    setCircuitName(c?.name ?? '');
    if (!circuitId) { setRanking([]); return; }

    try {
      const cfgRes = await api.get(`/circuits/${circuitId}/config-torneo`);
      setEsNacional(cfgRes.data?.tipo === 'nacional');
    } catch { setEsNacional(false); }

    cargarRanking(circuitId);
  };

  const handleRecalcular = async () => {
    if (!selectedCircuit) return;
    if (!confirm(`¿Recalcular el ranking del ${circuitName} con el nuevo sistema de desempate?\n\nEsto aplica el criterio de porcentaje de sets y tantos en lugar de acumulados absolutos.`)) return;
    setRecalculando(true); setRecalcularMsg('');
    try {
      const res = await api.post(`/rankings/recalcular-stats/${selectedCircuit}`);
      setRecalcularMsg(`✅ Recalculado — ${res.data.jugadores} jugadores`);
      cargarRanking(selectedCircuit);
    } catch (e: any) {
      setRecalcularMsg(`❌ ${e?.response?.data?.error ?? 'Error al recalcular'}`);
    } finally { setRecalculando(false); }
  };

  const handleGuardar = async () => {
    if (!selectedCircuit) return;
    if (!confirm(`¿Guardar este ranking del ${circuitName} como base para el siguiente circuito?`)) return;
    setGuardando(true); setGuardadoMsg('');
    try {
      const res = await api.post(`/rankings/guardar-final/${selectedCircuit}`);
      setGuardadoMsg(`✅ ${res.data.message}`);
    } catch (e: any) {
      setGuardadoMsg(`❌ ${e?.response?.data?.error ?? 'Error al guardar'}`);
    } finally { setGuardando(false); }
  };

  const handleGenerarBracket = async () => {
    if (!selectedCircuit) return;
    if (!confirm(`¿Generar el bracket de cruces con los top 16 de este ranking?\n\nSe usarán los 16 mejor rankeados como semillas del bracket.\nEsto reemplaza cualquier bracket anterior.`)) return;
    setGenerandoBracket(true); setBracketMsg('');
    try {
      const res = await api.post(`/matches/regenerar-bracket/${selectedCircuit}`);
      setBracketMsg(`✅ ${res.data.message}`);
      if (res.data.seeding) {
        const seeds = res.data.seeding.map((s: any) => `#${s.seed} ${s.nombre}`).join(', ');
        console.log('Seeding bracket:', seeds);
      }
    } catch (e: any) {
      setBracketMsg(`❌ ${e?.response?.data?.error ?? 'Error al generar bracket'}`)
    } finally { setGenerandoBracket(false); }
  };

  const handleIniciarC2 = async () => {
    if (!selectedCircuit || !selectedTournament) return;
    const currentCircuit = allCircuits.find(c => c.id === Number(selectedCircuit));
    if (!currentCircuit) return;
    const nextCircuit = allCircuits.find(c =>
      c.tournamentId === currentCircuit.tournamentId &&
      c.order === currentCircuit.order + 1
    );
    if (!nextCircuit) {
      setIniciarC2Msg('❌ No se encontró el Circuito 2 para este torneo.');
      return;
    }
    const msg = '¿Iniciar ' + nextCircuit.name + ' con el ranking del ' + currentCircuit.name + '?\n\nInscribirá los 32 jugadores con posiciones de siembra (puntos en 0).\nEl Circuito 1 NO se modifica.';
    if (!confirm(msg)) return;
    setIniciandoC2(true); setIniciarC2Msg('');
    try {
      const res = await api.post('/circuits/' + nextCircuit.id + '/init-from-circuit/' + selectedCircuit);
      setIniciarC2Msg('✅ ' + res.data.message + ' — ' + res.data.inscriptos + ' jugadores inscriptos en ' + nextCircuit.name);
    } catch (e: any) {
      setIniciarC2Msg('❌ ' + (e?.response?.data?.error ?? 'Error al iniciar Circuito 2'));
    } finally { setIniciandoC2(false); }
  };

  const filtrado = ranking
    .filter(e => filtro === 'general' || e.categoria === filtro)
    .filter(e =>
      busqueda === '' ||
      `${e.lastName} ${e.firstName}`.toLowerCase().includes(busqueda.toLowerCase()) ||
      e.club.toLowerCase().includes(busqueda.toLowerCase())
    );

  const counts = {
    general: ranking.length,
    master:  ranking.filter(e => e.categoria === 'master').length,
    primera: ranking.filter(e => e.categoria === 'primera').length,
    segunda: ranking.filter(e => e.categoria === 'segunda').length,
    tercera: ranking.filter(e => e.categoria === 'tercera').length,
  };

  const corteBracket = esNacional ? 16 : null;

  return (
    <div className="min-h-screen bg-carbon-100">
      <div className="max-w-5xl mx-auto px-4 py-8">

        <div className="text-center mb-6">
          <h1 className="font-display text-5xl text-gold mb-1">RANKING DEL CIRCUITO</h1>
          <p className="text-chalk/50 text-sm">
            {tournamentName && circuitName ? `${tournamentName} — ${circuitName}` : 'Seleccioná un torneo y circuito'}
          </p>
        </div>

        {/* Selectores */}
        <div className="flex flex-wrap gap-3 justify-center mb-6">
          <select className="input w-56" value={selectedTournament}
            onChange={e => handleTournamentChange(e.target.value)}>
            <option value="">Seleccioná un torneo</option>
            {tournaments.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <select className="input w-56" value={selectedCircuit}
            onChange={e => handleCircuitChange(e.target.value)} disabled={!selectedTournament}>
            <option value="">Seleccioná un circuito</option>
            {circuitsFiltrados.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>

        {!selectedCircuit && !loading && (
          <div className="text-center py-16 text-chalk/30">
            <p className="text-5xl mb-4">🏆</p>
            <p className="text-lg font-display">Seleccioná un torneo y circuito</p>
          </div>
        )}

        {loading && (
          <div className="text-center py-16">
            <span className="text-gold font-display text-2xl">Calculando ranking...</span>
          </div>
        )}

        {!loading && selectedCircuit && ranking.length > 0 && (
          <>
            {/* Badge Nacional */}
            {esNacional && (
              <div className="flex justify-center mb-4">
                <span className="bg-blue-900/30 border border-blue-700/40 text-blue-400 text-xs px-3 py-1 rounded-lg font-mono">
                  🏆 Nacional — Top 16 clasifican al bracket
                </span>
              </div>
            )}

            {/* Acciones admin */}
            {user?.role === 'admin' && (
              <div className="flex flex-col items-center gap-3 mb-6">

                {/* Botón Recalcular ranking */}
                <div className="flex flex-col items-center gap-1 w-full max-w-sm">
                  <button
                    className="btn-secondary px-6 w-full"
                    style={{ background: 'linear-gradient(90deg,#1a3a1a,#2d5a2d)', borderColor: '#4ade80' }}
                    disabled={recalculando}
                    onClick={handleRecalcular}
                  >
                    {recalculando ? 'Recalculando...' : '🔄 Recalcular ranking (nuevo criterio)'}
                  </button>
                  {recalcularMsg && (
                    <span className={`text-sm ${recalcularMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
                      {recalcularMsg}
                    </span>
                  )}
                  <p className="text-chalk/30 text-xs text-center">
                    Aplica el desempate por % de sets y tantos (Alternativa 4)
                  </p>
                </div>

                {/* Botón generar bracket — solo para Nacional */}
                {esNacional && (
                  <div className="flex flex-col items-center gap-1 w-full max-w-sm">
                    <button className="btn-primary px-6 w-full" disabled={generandoBracket} onClick={handleGenerarBracket}>
                      {generandoBracket ? 'Generando...' : '🏆 Generar bracket de cruces (top 16)'}
                    </button>
                    {bracketMsg && (
                      <span className={`text-sm ${bracketMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
                        {bracketMsg}
                      </span>
                    )}
                    <p className="text-chalk/30 text-xs text-center">
                      Crea los 15 partidos del bracket con los top 16 del ranking
                    </p>
                  </div>
                )}

                {/* Botón Iniciar Circuito 2 — solo para Nacional */}
                {esNacional && (
                  <div className="flex flex-col items-center gap-1 w-full max-w-sm">
                    <button className="btn-primary px-6 w-full" style={{background:'linear-gradient(90deg,#014f86,#0277bd)'}} disabled={iniciandoC2} onClick={handleIniciarC2}>
                      {iniciandoC2 ? 'Iniciando...' : '🚀 Iniciar Circuito 2 con este ranking'}
                    </button>
                    {iniciarC2Msg && (
                      <span className={`text-sm ${iniciarC2Msg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
                        {iniciarC2Msg}
                      </span>
                    )}
                    <p className="text-chalk/30 text-xs text-center">
                      Inscribe los 32 jugadores en el Circuito 2 con las posiciones de siembra del Circuito 1 (puntos en 0)
                    </p>
                  </div>
                )}

                {/* Botón siguiente circuito */}
                <div className="flex flex-col items-center gap-1 w-full max-w-sm">
                  <button className="btn-secondary px-6 w-full" disabled={guardando} onClick={handleGuardar}>
                    {guardando ? 'Guardando...' : '💾 Usar como base para el siguiente circuito'}
                  </button>
                  {guardadoMsg && (
                    <span className={`text-sm ${guardadoMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
                      {guardadoMsg}
                    </span>
                  )}
                  <p className="text-chalk/30 text-xs">Presioná este botón antes de generar los partidos del siguiente circuito</p>
                </div>

              </div>
            )}

            {/* Filtros por categoría — solo para no nacionales */}
            {!esNacional && (
              <div className="flex gap-2 flex-wrap justify-center mb-4">
                {(['general', 'master', 'primera', 'segunda', 'tercera'] as const).map(cat => (
                  <button key={cat} onClick={() => setFiltro(cat)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                      filtro === cat
                        ? cat === 'general' ? 'bg-gold/20 text-gold border-gold/40' : CAT_COLORS[cat]
                        : 'border-felt-light/20 text-chalk/40 hover:border-chalk/30'
                    }`}>
                    {cat === 'general' ? 'General' : CAT_LABEL[cat]}
                    <span className="ml-1.5 opacity-60">({counts[cat]})</span>
                  </button>
                ))}
              </div>
            )}

            {/* Buscador */}
            <div className="mb-4">
              <input type="text" placeholder="Buscar jugador o club..."
                className="input w-full max-w-sm mx-auto block"
                value={busqueda} onChange={e => setBusqueda(e.target.value)} />
            </div>

            {/* Tabla */}
            <div className="card p-0 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-felt-light/10 text-chalk/40 text-xs uppercase tracking-widest">
                    <th className="text-center px-3 py-3 w-12">#</th>
                    <th className="text-left px-4 py-3">Jugador</th>
                    <th className="text-left px-4 py-3 hidden sm:table-cell">Club</th>
                    <th className="text-center px-3 py-3 hidden md:table-cell">Categoría</th>
                    <th className="text-center px-3 py-3">Pts</th>
                    <th className="text-center px-3 py-3 hidden sm:table-cell">Sets</th>
                    <th className="text-center px-3 py-3 hidden md:table-cell">Tantos</th>
                    <th className="text-center px-3 py-3 hidden lg:table-cell">Prom.</th>
                  </tr>
                </thead>
                <tbody>
                  {filtrado.map((entry) => (
                    <>
                      {corteBracket && filtro === 'general' && entry.posicion === corteBracket + 1 && (
                        <tr key={`corte-${entry.posicion}`}>
                          <td colSpan={8} className="px-4 py-2">
                            <div className="flex items-center gap-3">
                              <div className="flex-1 h-px bg-gold/40"></div>
                              <span className="text-gold/70 text-xs font-mono uppercase tracking-widest font-bold whitespace-nowrap">
                                ▲ Top {corteBracket} clasificados al bracket
                              </span>
                              <div className="flex-1 h-px bg-gold/40"></div>
                            </div>
                          </td>
                        </tr>
                      )}
                      <tr key={entry.playerId}
                        className={`border-b border-felt-light/5 transition-colors ${
                          corteBracket && entry.posicion <= corteBracket ? 'bg-blue-900/10' :
                          entry.posicion <= 8  ? 'bg-yellow-900/5' :
                          entry.posicion <= 32 ? 'bg-blue-900/5'   :
                          entry.posicion <= 64 ? 'bg-green-900/5'  : ''
                        }`}>
                        <td className="text-center px-3 py-2.5">
                          <span className={`font-mono font-bold text-sm ${
                            corteBracket && entry.posicion <= corteBracket ? 'text-blue-400' :
                            entry.posicion <= 8  ? 'text-yellow-400' :
                            entry.posicion <= 32 ? 'text-blue-400'   :
                            entry.posicion <= 64 ? 'text-green-400'  : 'text-chalk/40'
                          }`}>{entry.posicion}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="text-chalk font-semibold">{entry.lastName}, {entry.firstName}</span>
                        </td>
                        <td className="px-4 py-2.5 hidden sm:table-cell text-chalk/50 text-xs">{entry.club || '—'}</td>
                        <td className="px-3 py-2.5 hidden md:table-cell text-center">
                          <span className={`text-xs px-2 py-0.5 rounded ${CAT_COLORS[entry.categoria] ?? ''}`}>
                            {CAT_LABEL[entry.categoria] ?? entry.categoria}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="text-gold font-bold font-mono">{entry.puntos}</span>
                        </td>
                        <td className="px-3 py-2.5 text-center hidden sm:table-cell text-chalk/70 font-mono">{entry.setsGanados}</td>
                        <td className="px-3 py-2.5 text-center hidden md:table-cell text-chalk/70 font-mono">{entry.tantos}</td>
                        <td className="px-3 py-2.5 text-center hidden lg:table-cell text-chalk/50 font-mono text-xs">{entry.promedio.toFixed(2)}</td>
                      </tr>
                    </>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-center text-chalk/20 text-xs mt-4">
              {filtrado.length} jugadores · ordenados por puntos → % sets → % tantos → promedio
            </p>
          </>
        )}

        {!loading && selectedCircuit && ranking.length === 0 && (
          <div className="text-center py-16 text-chalk/30">
            <p className="text-5xl mb-4">🎱</p>
            <p className="text-lg font-display">Sin datos para este circuito</p>
            <p className="text-sm mt-2">El circuito aún no tiene partidos finalizados.</p>
          </div>
        )}
      </div>
    </div>
  );
}
