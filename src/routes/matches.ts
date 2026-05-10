import { useEffect, useState } from 'react';
import { api } from '../services/api';
import { LoadingSpinner, EmptyState, Modal } from '../components/ui';

interface Venue { id: number; name: string; departamentoId?: number; tables?: { id: number; number: number; status: string }[]; }
interface Cruce {
  id: number;
  round: number;
  serieId?: string;
  fase: string;
  phaseId: number;
  playerA?: any;
  playerB?: any;
  slotA?: string;
  slotB?: string;
  tableId?: number;
  table?: any;
  scheduledAt?: string;
  status: string;
}

export default function CrucesPage() {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [cruces, setCruces] = useState<Cruce[]>([]);
  const [loading, setLoading] = useState(true);
  const [torneoDepId, setTorneoDepId] = useState<number | null>(null);
  const [asignandoModal, setAsignandoModal] = useState<Cruce | null>(null);
  const [form, setForm] = useState({ venueId: '', tableId: '', scheduledAt: '', hora: '', minutos: '' });
  const [saving, setSaving] = useState(false);
  const [filtroFase, setFiltroFase] = useState<string>('todas');
  const [disparando, setDisparando] = useState(false);
  const [disparoMsg, setDisparoMsg] = useState('');

  const cargarDatos = async () => {
    const [vRes, mRes, tRes] = await Promise.all([
      api.get('/venues'),
      api.get('/matches'),
      api.get('/tournaments'),
    ]);
    setVenues(vRes.data);

    const matchesCruces = mRes.data.filter((m: any) =>
      m.phase?.type === 'primera' ||
      m.phase?.type === 'master' ||
      (m.serieId && (m.serieId.includes('reduccion') || m.serieId.includes('repechaje')))
    ).map((m: any) => ({
      id: m.id,
      round: m.round,
      serieId: m.serieId,
      fase: m.serieId?.includes('reduccion') || m.serieId?.includes('repechaje')
        ? 'reduccion'
        : m.phase?.type ?? '',
      phaseId: m.phaseId,
      playerA: m.playerA,
      playerB: m.playerB,
      slotA: m.slotA,
      slotB: m.slotB,
      tableId: m.tableId,
      table: m.table,
      scheduledAt: m.scheduledAt,
      status: m.status,
    }));

    matchesCruces.sort((a: Cruce, b: Cruce) => {
      const orden: Record<string, number> = { reduccion: 1, primera: 2, master: 3 };
      if (a.fase !== b.fase) return (orden[a.fase] ?? 9) - (orden[b.fase] ?? 9);
      if (!a.scheduledAt && !b.scheduledAt) return a.round - b.round;
      if (!a.scheduledAt) return 1;
      if (!b.scheduledAt) return -1;
      return new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime();
    });

    setCruces(matchesCruces);
    const torneoActivo = tRes.data.find((t: any) => t.active) ?? tRes.data[0];
    setTorneoDepId(torneoActivo?.departamentoId ?? null);
    setLoading(false);
  };

  useEffect(() => {
    cargarDatos().catch(() => setLoading(false));
  }, []);

  const handleDispararReduccion = async () => {
    setDisparando(true);
    setDisparoMsg('');
    try {
      const res = await api.post('/matches/trigger-reduccion/30');
      setDisparoMsg(`✅ ${res.data.message}`);
      await cargarDatos();
    } catch (err: any) {
      setDisparoMsg(`❌ ${err?.response?.data?.error ?? 'Error al disparar reducción'}`);
    } finally {
      setDisparando(false);
    }
  };

  const handleDispararSegunda = async () => {
    setDisparando(true);
    setDisparoMsg('');
    try {
      const res = await api.post('/matches/trigger-segunda/31');
      setDisparoMsg(`✅ ${res.data.message}`);
      await cargarDatos();
    } catch (err: any) {
      setDisparoMsg(`❌ ${err?.response?.data?.error ?? 'Error al disparar Segunda'}`);
    } finally {
      setDisparando(false);
    }
  };

  const handleDispararPrimera = async () => {
    setDisparando(true);
    setDisparoMsg('');
    try {
      const res = await api.post('/matches/trigger-primera/32');
      setDisparoMsg(`✅ ${res.data.message}`);
      await cargarDatos();
    } catch (err: any) {
      setDisparoMsg(`❌ ${err?.response?.data?.error ?? 'Error al disparar Primera'}`);
    } finally {
      setDisparando(false);
    }
  };

  const abrirAsignacion = (cruce: Cruce) => {
    setAsignandoModal(cruce);
    const horaCompleta = cruce.scheduledAt ? cruce.scheduledAt.split('T')[1]?.slice(0, 5) : '';
    setForm({
      venueId: cruce.table?.venue?.id?.toString() ?? '',
      tableId: cruce.tableId?.toString() ?? '',
      scheduledAt: cruce.scheduledAt ? cruce.scheduledAt.split('T')[0] : '',
      hora: horaCompleta.split(':')[0] ?? '',
      minutos: horaCompleta.split(':')[1] ?? '00',
    });
  };

  const handleGuardar = async () => {
    if (!asignandoModal) return;
    setSaving(true);
    try {
      const scheduledAt = form.scheduledAt && form.hora
        ? new Date(`${form.scheduledAt}T${form.hora}:${form.minutos || '00'}:00`).toISOString()
        : undefined;

      if (form.tableId) {
        await api.put(`/matches/${asignandoModal.id}/assign`, { tableId: parseInt(form.tableId) });
      }
      if (scheduledAt) {
        await api.put(`/matches/${asignandoModal.id}`, { scheduledAt });
      }

      setAsignandoModal(null);
      await cargarDatos();
    } catch (err: any) {
      alert(err?.response?.data?.error ?? 'Error al asignar');
    } finally {
      setSaving(false);
    }
  };

  const sedesFiltradas = torneoDepId
    ? venues.filter(v => v.departamentoId === torneoDepId)
    : venues;

  const getTablasDeSede = (venueId: string) => {
    const venue = sedesFiltradas.find(v => v.id === parseInt(venueId));
    return venue?.tables ?? [];
  };

  const pn = (player: any, slot?: string) => {
    if (player) return `${player.lastName}, ${player.firstName}`;
    if (slot) return slot;
    return '—';
  };

  const labelFase = (fase: string) => {
    if (fase === 'reduccion') return 'Reducción Clasif.';
    if (fase === 'primera') return 'Tercera Fase';
    if (fase === 'master') return 'Fase Final';
    return fase;
  };

  const crucesFiltrados = filtroFase === 'todas' ? cruces : cruces.filter(c => c.fase === filtroFase);

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="px-6 pt-6 pb-4 border-b border-felt-light/20 flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-4xl text-gold">CRUCES</h1>
          <p className="text-chalk/50 text-sm mt-1">Asignación de sede, mesa, fecha y hora — Reducción, Primera y Máster</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex gap-2 flex-wrap justify-end">
            <button
              className="btn-secondary text-xs py-1.5 px-3"
              disabled={disparando}
              onClick={handleDispararReduccion}
            >
              {disparando ? 'Procesando...' : '⚡ Rellenar cruces de reducción'}
            </button>
            <button
              className="btn-secondary text-xs py-1.5 px-3"
              disabled={disparando}
              onClick={handleDispararSegunda}
            >
              {disparando ? 'Procesando...' : '⚡ Rellenar slots de Primera'}
            </button>
            <button
              className="btn-secondary text-xs py-1.5 px-3"
              disabled={disparando}
              onClick={handleDispararPrimera}
            >
              {disparando ? 'Procesando...' : '⚡ Rellenar slots de Master'}
            </button>
          </div>
          {disparoMsg && (
            <span className={`text-xs ${disparoMsg.startsWith('✅') ? 'text-green-400' : 'text-red-400'}`}>
              {disparoMsg}
            </span>
          )}
        </div>
      </div>

      <div className="p-6 space-y-4">
        <div className="flex gap-2 flex-wrap">
          {['todas', 'reduccion', 'primera', 'master'].map(f => (
            <button
              key={f}
              className={`py-1 px-3 text-xs rounded-lg border transition-all ${filtroFase === f ? 'border-gold/40 text-gold bg-gold/10' : 'border-felt-light/20 text-chalk/40 hover:border-chalk/30'}`}
              onClick={() => setFiltroFase(f)}
            >
              {f === 'todas' ? 'Todas' : labelFase(f)}
            </button>
          ))}
          <span className="text-chalk/30 text-xs self-center ml-2">{crucesFiltrados.length} cruces</span>
        </div>

        {crucesFiltrados.length === 0 ? (
          <EmptyState message="No hay cruces. Generá los partidos desde Fixture primero." />
        ) : (
          <div className="card p-0 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-felt-light/10 text-chalk/40 text-xs uppercase tracking-widest">
                  <th className="text-left px-4 py-3">Fase</th>
                  <th className="text-left px-4 py-3">Cruce</th>
                  <th className="text-left px-4 py-3">Jugador A</th>
                  <th className="text-left px-4 py-3">Jugador B</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Sede / Mesa</th>
                  <th className="text-left px-4 py-3 hidden md:table-cell">Fecha / Hora</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {crucesFiltrados.map(cruce => {
                  const asignado = cruce.tableId || cruce.scheduledAt;
                  return (
                    <tr key={cruce.id} className={`border-b border-felt-light/5 ${asignado ? 'bg-green-900/5' : ''}`}>
                      <td className="px-4 py-3">
                        <span className={`badge-status text-xs ${
                          cruce.fase === 'reduccion' ? 'bg-orange-900/30 text-orange-400' :
                          cruce.fase === 'primera' ? 'bg-blue-900/30 text-blue-400' :
                          'bg-gold/20 text-gold'
                        }`}>
                          {labelFase(cruce.fase)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-chalk/40 text-xs font-mono">
                        {cruce.serieId?.includes('repechaje') ? 'Repechaje' : `#${cruce.round}`}
                      </td>
                      <td className="px-4 py-3 text-chalk/80">{pn(cruce.playerA, cruce.slotA)}</td>
                      <td className="px-4 py-3 text-chalk/80">{pn(cruce.playerB, cruce.slotB)}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {cruce.table ? (
                          <span className="text-green-400/60 text-xs font-mono">
                            {cruce.table.venue?.name} — Mesa {cruce.table.number}
                          </span>
                        ) : (
                          <span className="text-chalk/20 text-xs">Sin asignar</span>
                        )}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {cruce.scheduledAt ? (
                          <span className="text-chalk/60 text-xs font-mono">
                            {new Date(cruce.scheduledAt).toLocaleString('es-UY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                          </span>
                        ) : (
                          <span className="text-chalk/20 text-xs">Sin fecha</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          className="py-0.5 px-2 text-xs rounded border border-gold/30 text-gold/70 hover:bg-gold/10 transition-all"
                          onClick={() => abrirAsignacion(cruce)}
                        >
                          {asignado ? 'Editar' : 'Asignar'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {asignandoModal && (
        <Modal title={`ASIGNAR — ${labelFase(asignandoModal.fase)} ${asignandoModal.serieId?.includes('repechaje') ? 'Repechaje' : `#${asignandoModal.round}`}`} onClose={() => setAsignandoModal(null)}>
          <div className="space-y-4">
            <div>
              <p className="text-chalk/60 text-xs uppercase tracking-widest mb-1">Partido</p>
              <p className="text-chalk/80 text-sm">
                {pn(asignandoModal.playerA, asignandoModal.slotA)} vs {pn(asignandoModal.playerB, asignandoModal.slotB)}
              </p>
            </div>

            <div>
              <label className="block text-chalk/60 text-xs uppercase tracking-widest mb-1.5">
                Sede {torneoDepId ? '(filtradas por departamento)' : ''}
              </label>
              <select className="input" value={form.venueId} onChange={e => setForm({ ...form, venueId: e.target.value, tableId: '' })}>
                <option value="">Seleccionar sede...</option>
                {sedesFiltradas.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>

            {form.venueId && (
              <div>
                <label className="block text-chalk/60 text-xs uppercase tracking-widest mb-1.5">Mesa</label>
                <select className="input" value={form.tableId} onChange={e => setForm({ ...form, tableId: e.target.value })}>
                  <option value="">Seleccionar mesa...</option>
                  {getTablasDeSede(form.venueId).map((t: any) => (
                    <option key={t.id} value={t.id}>Mesa {t.number} — {t.status}</option>
                  ))}
                </select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-chalk/60 text-xs uppercase tracking-widest mb-1.5">Fecha</label>
                <input type="date" className="input" value={form.scheduledAt} onChange={e => setForm({ ...form, scheduledAt: e.target.value })} />
              </div>
              <div>
                <label className="block text-chalk/60 text-xs uppercase tracking-widest mb-1.5">Hora (24hs)</label>
                <div className="flex gap-2">
                  <select className="input flex-1" value={form.hora} onChange={e => setForm({ ...form, hora: e.target.value })}>
                    <option value="">HH</option>
                    {Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')).map(h => (
                      <option key={h} value={h}>{h}</option>
                    ))}
                  </select>
                  <select className="input flex-1" value={form.minutos} onChange={e => setForm({ ...form, minutos: e.target.value })}>
                    <option value="">MM</option>
                    {['00', '15', '30', '45'].map(m => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button className="btn-primary flex-1" disabled={saving} onClick={handleGuardar}>
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              <button className="btn-secondary flex-1" onClick={() => setAsignandoModal(null)}>Cancelar</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
