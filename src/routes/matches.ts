const handleDispararMaster = async () => {
  setDisparando(true);
  setDisparoMsg('');
  try {
    const res = await api.post('/matches/trigger-master/33');
    setDisparoMsg(`✅ ${res.data.message}`);
    await cargarDatos();
  } catch (err: any) {
    setDisparoMsg(`❌ ${err?.response?.data?.error ?? 'Error al rellenar Octavos'}`);
  } finally {
    setDisparando(false);
  }
};
