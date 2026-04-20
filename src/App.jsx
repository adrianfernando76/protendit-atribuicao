import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

const GRUPOS = {
  projinternos:  { label: 'Proj. Internos',  cor: '#7B8FFF', bg: '#1a1d3a', bd: '#2a3080' },
  verificadores: { label: 'Verificadores',   cor: '#FFB347', bg: '#2a1f0a', bd: '#5a3a10' },
  projexternos:  { label: 'Proj. Externos',  cor: '#7DD4B0', bg: '#0d2420', bd: '#1a5040' },
}

const SNAP = 8

export default function App() {
  const [pessoas, setPessoas]     = useState([])
  const [contratos, setContratos] = useState([])
  const [vinculos, setVinculos]   = useState([])
  const [sel, setSel]             = useState(null)
  const [modal, setModal]         = useState(null)
  const [arrows, setArrows]       = useState([])
  const [guides, setGuides]       = useState([])
  const canvasRef  = useRef(null)
  const dragRef    = useRef(null)
  const arrowTimer = useRef(null)

  const loadAll = useCallback(async () => {
    const [{ data: p }, { data: c }, { data: pc }, { data: v }] = await Promise.all([
      supabase.from('pessoas').select('*').order('criado_em'),
      supabase.from('contratos').select('*').order('criado_em'),
      supabase.from('pecas').select('*').order('ordem'),
      supabase.from('vinculos').select('*'),
    ])
    setPessoas(p || [])
    setContratos((c || []).map(ct => ({ ...ct, pecas: (pc || []).filter(pc => pc.contrato_id === ct.id) })))
    setVinculos(v || [])
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  useEffect(() => {
    const ch = supabase.channel('rt-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pessoas' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contratos' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pecas' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vinculos' }, loadAll)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [loadAll])

  function scheduleArrows() {
    if (arrowTimer.current) clearTimeout(arrowTimer.current)
    arrowTimer.current = setTimeout(calcArrows, 60)
  }

  useEffect(() => { scheduleArrows() }, [vinculos, pessoas, contratos])
  useEffect(() => { window.addEventListener('resize', calcArrows); return () => window.removeEventListener('resize', calcArrows) }, [])

  function calcArrows() {
    if (!canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const boxes = []
    canvasRef.current.querySelectorAll('.draggable').forEach(el => {
      const r = el.getBoundingClientRect()
      boxes.push({ id: el.id, x: r.left - rect.left, y: r.top - rect.top, w: r.width, h: r.height })
    })
    const result = []
    vinculos.forEach(v => {
      const pEl = document.getElementById('card-' + v.pessoa_id)
      const pcEl = document.getElementById('pec-' + v.peca_id)
      if (!pEl || !pcEl) return
      const pR = pEl.getBoundingClientRect()
      const pcR = pcEl.getBoundingClientRect()
      const x1 = pR.right - rect.left
      const y1 = pR.top + pR.height / 2 - rect.top
      const x2 = pcR.left - rect.left
      const y2 = pcR.top + pcR.height / 2 - rect.top
      const midX = (x1 + x2) / 2
      const midY = (y1 + y2) / 2
      let collision = null
      boxes.forEach(b => {
        if (b.id === 'card-' + v.pessoa_id) return
        if (midX > b.x + 8 && midX < b.x + b.w - 8 && midY > b.y + 8 && midY < b.y + b.h - 8) collision = b
      })
      result.push({ x1, y1, x2, y2, midX, midY, safeY: collision ? collision.y - 18 : null })
    })
    setArrows(result)
  }

  function pessoaLinks(pid) {
    return vinculos.filter(v => v.pessoa_id === pid).map(v => {
      for (const ct of contratos) {
        const pc = ct.pecas.find(p => p.id === v.peca_id)
        if (pc) return `${ct.num} ${ct.etapa} / ${pc.nome}`
      }
      return null
    }).filter(Boolean)
  }

  async function toggleLink(pecaId) {
    if (!sel) return
    const exists = vinculos.find(v => v.pessoa_id === sel && v.peca_id === pecaId)
    if (exists) {
      setVinculos(prev => prev.filter(v => v.id !== exists.id))
      await supabase.from('vinculos').delete().eq('id', exists.id)
    } else {
      const novo = { pessoa_id: sel, peca_id: pecaId, id: 'tmp-' + Date.now() }
      setVinculos(prev => [...prev, novo])
      await supabase.from('vinculos').insert({ pessoa_id: sel, peca_id: pecaId })
    }
  }

  async function savePessoa(nome, grupo) {
    if (!nome.trim()) return
    const lista = pessoas.filter(p => p.grupo === grupo)
    const lastY = lista.length ? Math.max(...lista.map(p => p.pos_y || 0)) + 96 : 16
    const nova = { id: 'tmp-' + Date.now(), nome: nome.trim(), grupo, pos_x: 16, pos_y: lastY, criado_em: new Date().toISOString() }
    setPessoas(prev => [...prev, nova])
    await supabase.from('pessoas').insert({ nome: nome.trim(), grupo, pos_x: 16, pos_y: lastY })
    setModal(null)
  }

  async function saveContrato(num, etapa, pecasStr) {
    if (!num.trim() || !etapa.trim()) return
    const px = 600 + contratos.length * 158
    const { data: ct } = await supabase.from('contratos').insert({ num: num.trim(), etapa: etapa.trim(), pos_x: px, pos_y: 16 }).select().single()
    const nomes = pecasStr.split(',').map(s => s.trim()).filter(Boolean)
    if (nomes.length) await supabase.from('pecas').insert(nomes.map((nome, i) => ({ contrato_id: ct.id, nome, ordem: i })))
    setModal(null)
  }

  async function editPessoa(id, nome, grupo) {
    if (!nome.trim()) return
    setPessoas(prev => prev.map(p => p.id === id ? { ...p, nome: nome.trim(), grupo } : p))
    await supabase.from('pessoas').update({ nome: nome.trim(), grupo }).eq('id', id)
    setModal(null)
  }

  async function editContrato(id, num, etapa) {
    if (!num.trim() || !etapa.trim()) return
    setContratos(prev => prev.map(c => c.id === id ? { ...c, num: num.trim(), etapa: etapa.trim() } : c))
    await supabase.from('contratos').update({ num: num.trim(), etapa: etapa.trim() }).eq('id', id)
    setModal(null)
  }

  async function delPessoa(id) {
    setPessoas(prev => prev.filter(p => p.id !== id))
    setVinculos(prev => prev.filter(v => v.pessoa_id !== id))
    if (sel === id) setSel(null)
    await supabase.from('pessoas').delete().eq('id', id)
  }

  async function delContrato(id) {
    const pcIds = contratos.find(c => c.id === id)?.pecas.map(p => p.id) || []
    setContratos(prev => prev.filter(c => c.id !== id))
    setVinculos(prev => prev.filter(v => !pcIds.includes(v.peca_id)))
    await supabase.from('contratos').delete().eq('id', id)
  }

  function startDrag(e, table, id) {
    if (e.button !== 0) return
    const el = document.getElementById('card-' + id)
    if (!el) return
    const startX = e.clientX, startY = e.clientY
    const startL = parseFloat(el.style.left) || 0
    const startT = parseFloat(el.style.top) || 0
    dragRef.current = { id, table, el, startX, startY, startL, startT, moved: false }
    e.preventDefault()
    e.stopPropagation()
  }

  useEffect(() => {
    const mm = e => {
      if (!dragRef.current) return
      const { el, startX, startY, startL, startT, id } = dragRef.current
      let nx = Math.max(0, startL + e.clientX - startX)
      let ny = Math.max(0, startT + e.clientY - startY)
      const allCards = [...pessoas, ...contratos]
      const newGuides = []
      allCards.forEach(item => {
        if (item.id === id) return
        const ox = item.pos_x || 0
        const oy = item.pos_y || 0
        if (Math.abs(ny - oy) < SNAP) { ny = oy; newGuides.push({ type: 'h', y: oy }) }
        if (Math.abs(nx - ox) < SNAP) { nx = ox; newGuides.push({ type: 'v', x: ox }) }
      })
      el.style.left = nx + 'px'
      el.style.top = ny + 'px'
      dragRef.current.moved = true
      dragRef.current.nx = nx
      dragRef.current.ny = ny
      setGuides(newGuides)
      scheduleArrows()
    }
    const mu = async () => {
      if (!dragRef.current) return
      const { table, id, moved, nx, ny } = dragRef.current
      dragRef.current = null
      setGuides([])
      if (moved && nx !== undefined) {
        if (table === 'pessoas') setPessoas(prev => prev.map(p => p.id === id ? { ...p, pos_x: nx, pos_y: ny } : p))
        else setContratos(prev => prev.map(c => c.id === id ? { ...c, pos_x: nx, pos_y: ny } : c))
        await supabase.from(table).update({ pos_x: nx, pos_y: ny }).eq('id', id)
      }
    }
    window.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', mu)
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu) }
  }, [pessoas, contratos])

  const s = {
    app: { background: '#0f0f13', height: '100vh', fontFamily: "'Segoe UI', sans-serif", fontSize: 13, color: '#e2e2e8', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
    topbar: { display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: '1px solid #1e1e28', background: '#0f0f13', zIndex: 100, flexShrink: 0 },
    canvasWrap: { flex: 1, overflow: 'auto', position: 'relative' },
    canvas: { position: 'relative', width: 3000, height: 2500 },
    card: (isSel) => ({ background: '#16161f', border: isSel ? '1.5px solid #7B8FFF' : '1px solid #2a2a38', borderRadius: 10, padding: '9px 10px', width: 180 }),
    ctCard: { background: '#16161f', border: '1px solid #2a2a38', borderRadius: 10, width: 150, overflow: 'hidden' },
    btn: { fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid #2a2a35', background: '#1a1a24', color: '#b0b0c0', cursor: 'pointer' },
    btnGreen: { fontSize: 12, padding: '5px 12px', borderRadius: 6, border: '1px solid #1D9E75', background: '#0d3326', color: '#1D9E75', cursor: 'pointer' },
    handle: { cursor: 'grab', color: '#333', fontSize: 14, padding: '0 4px', userSelect: 'none', lineHeight: 1 },
    peca: (linked) => ({ padding: '6px 10px', borderBottom: '1px solid #1e1e28', cursor: 'pointer', background: linked ? '#0d2a20' : '#16161f', color: linked ? '#7DD4B0' : '#666', display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }),
    dot: (linked) => ({ width: 6, height: 6, borderRadius: '50%', background: linked ? '#1D9E75' : '#2a2a38', flexShrink: 0 }),
    modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modalBox: { background: '#16161f', border: '1px solid #2a2a38', borderRadius: 12, padding: 20, width: 340 },
    inp: { width: '100%', marginBottom: 8, background: '#0f0f13', border: '1px solid #2a2a38', color: '#e2e2ee', borderRadius: 6, padding: '7px 10px', fontSize: 12, outline: 'none' },
  }

  return (
    <div style={s.app}>
      <div style={s.topbar}>
        <span style={{ fontWeight: 600, fontSize: 15, color: '#fff' }}>Atribuição de Peças</span>
        <span style={{ fontSize: 11, color: '#444' }}>Protendit</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button style={s.btn} onClick={() => setModal({ type: 'add-pessoa' })}>+ Pessoa</button>
          <button style={s.btnGreen} onClick={() => setModal({ type: 'add-contrato' })}>+ Contrato / Etapa</button>
        </div>
      </div>

      <div style={s.canvasWrap} ref={canvasRef}>
        <div style={s.canvas}>

          {/* Guias de alinhamento */}
          {guides.map((g, i) =>
            g.type === 'h'
              ? <div key={i} style={{ position: 'absolute', left: 0, top: g.y, width: '100%', height: 1, background: '#7B8FFF', opacity: 0.7, zIndex: 50, pointerEvents: 'none' }} />
              : <div key={i} style={{ position: 'absolute', top: 0, left: g.x, width: 1, height: '100%', background: '#7B8FFF', opacity: 0.7, zIndex: 50, pointerEvents: 'none' }} />
          )}

          {/* Setas */}
          <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M2 1L8 5L2 9" fill="none" stroke="#1D9E75" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>
            {arrows.map((a, i) => {
              const d = a.safeY !== null
                ? `M${a.x1} ${a.y1} C${a.midX} ${a.y1} ${a.midX} ${a.safeY} ${a.midX} ${a.safeY} C${a.midX} ${a.safeY} ${a.midX} ${a.y2} ${a.x2} ${a.y2}`
                : `M${a.x1} ${a.y1} C${a.midX} ${a.y1} ${a.midX} ${a.y2} ${a.x2} ${a.y2}`
              return <path key={i} d={d} fill="none" stroke="#1D9E75" strokeWidth="1.5" opacity="0.7" markerEnd="url(#arr)" />
            })}
          </svg>

          {/* Cards pessoas */}
          {pessoas.map(p => {
            const grp = GRUPOS[p.grupo] || GRUPOS.projinternos
            return (
              <div key={p.id} id={'card-' + p.id} className="draggable"
                style={{ position: 'absolute', left: p.pos_x || 16, top: p.pos_y || 16, zIndex: 10 }}>
                <div style={s.card(sel === p.id)} onClick={() => setSel(sel === p.id ? null : p.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4, gap: 4 }}>
                    <span style={s.handle} onMouseDown={e => { e.stopPropagation(); startDrag(e, 'pessoas', p.id) }}>⠿</span>
                    <span style={{ fontWeight: 500, color: '#e2e2ee', flex: 1, fontSize: 13 }}>{p.nome}</span>
                    <span style={{ color: '#555', fontSize: 13, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setModal({ type: 'edit-pessoa', data: p }) }}>✎</span>
                    <span style={{ color: '#555', fontSize: 16, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); delPessoa(p.id) }}>×</span>
                  </div>
                  <div style={{ fontSize: 10, color: grp.cor, marginBottom: 4, fontWeight: 500 }}>{grp.label}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {pessoaLinks(p.id).length > 0
                      ? pessoaLinks(p.id).map((t, i) => (
                        <span key={i} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 99, background: grp.bg, color: grp.cor, border: `1px solid ${grp.bd}`, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t}</span>
                      ))
                      : <span style={{ fontSize: 10, color: '#333' }}>sem vínculos</span>}
                  </div>
                </div>
              </div>
            )
          })}

          {/* Cards contratos */}
          {contratos.map(ct => (
            <div key={ct.id} id={'card-' + ct.id} className="draggable"
              style={{ position: 'absolute', left: ct.pos_x || 600, top: ct.pos_y || 16, zIndex: 10 }}>
              <div style={s.ctCard}>
                <div style={{ padding: '8px 10px', background: '#1c1c28', borderBottom: '1px solid #2a2a38', display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                  <span style={s.handle} onMouseDown={e => { e.stopPropagation(); startDrag(e, 'contratos', ct.id) }}>⠿</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 10, color: '#555' }}>{ct.num}</div>
                    <div style={{ fontWeight: 500, color: '#e2e2ee', fontSize: 13 }}>{ct.etapa}</div>
                  </div>
                  <span style={{ color: '#555', fontSize: 13, cursor: 'pointer' }} onClick={() => setModal({ type: 'edit-contrato', data: ct })}>✎</span>
                  <span style={{ color: '#555', fontSize: 16, cursor: 'pointer' }} onClick={() => delContrato(ct.id)}>×</span>
                </div>
                {ct.pecas.map(pc => {
                  const linked = vinculos.some(v => v.peca_id === pc.id)
                  return (
                    <div key={pc.id} id={'pec-' + pc.id} style={s.peca(linked)}
                      onClick={e => { e.stopPropagation(); toggleLink(pc.id) }}>
                      <div style={s.dot(linked)} />{pc.nome}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}

        </div>
      </div>

      {modal && (
        <div style={s.modal} onClick={() => setModal(null)}>
          <div style={s.modalBox} onClick={e => e.stopPropagation()}>
            {modal.type === 'add-pessoa' && <ModalPessoa title="Nova pessoa" onSave={savePessoa} onClose={() => setModal(null)} s={s} />}
            {modal.type === 'edit-pessoa' && <ModalPessoa title="Editar pessoa" data={modal.data} onSave={(n, g) => editPessoa(modal.data.id, n, g)} onClose={() => setModal(null)} s={s} />}
            {modal.type === 'add-contrato' && <ModalContrato title="Novo contrato / etapa" onSave={saveContrato} onClose={() => setModal(null)} s={s} />}
            {modal.type === 'edit-contrato' && <ModalContrato title="Editar contrato" data={modal.data} onSave={(n, e) => editContrato(modal.data.id, n, e)} onClose={() => setModal(null)} s={s} />}
          </div>
        </div>
      )}
    </div>
  )
}

function ModalPessoa({ title, data, onSave, onClose, s }) {
  const [nome, setNome] = useState(data?.nome || '')
  const [grupo, setGrupo] = useState(data?.grupo || 'projinternos')
  return <>
    <div style={{ fontWeight: 500, marginBottom: 12, color: '#e2e2ee' }}>{title}</div>
    <input style={s.inp} value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome" />
    <select style={s.inp} value={grupo} onChange={e => setGrupo(e.target.value)}>
      <option value="projinternos">Proj. Internos</option>
      <option value="verificadores">Verificadores</option>
      <option value="projexternos">Proj. Externos</option>
    </select>
    <div style={{ display: 'flex', gap: 8 }}>
      <button style={s.btn} onClick={onClose}>Cancelar</button>
      <button style={s.btnGreen} onClick={() => onSave(nome, grupo)}>Salvar</button>
    </div>
  </>
}

function ModalContrato({ title, data, onSave, onClose, s }) {
  const [num, setNum] = useState(data?.num || '')
  const [etapa, setEtapa] = useState(data?.etapa || '')
  const [pecas, setPecas] = useState('')
  return <>
    <div style={{ fontWeight: 500, marginBottom: 12, color: '#e2e2ee' }}>{title}</div>
    <input style={s.inp} value={num} onChange={e => setNum(e.target.value)} placeholder="Número (ex: CT 2455)" />
    <input style={s.inp} value={etapa} onChange={e => setEtapa(e.target.value)} placeholder="Etapa (ex: Unicev)" />
    {!data && <>
      <input style={s.inp} value={pecas} onChange={e => setPecas(e.target.value)} placeholder="Pilar, Viga, Terça, Patrão" />
      <div style={{ fontSize: 10, color: '#444', marginBottom: 8, marginTop: -4 }}>Tipos de peça separados por vírgula</div>
    </>}
    <div style={{ display: 'flex', gap: 8 }}>
      <button style={s.btn} onClick={onClose}>Cancelar</button>
      <button style={s.btnGreen} onClick={() => onSave(num, etapa, pecas)}>Salvar</button>
    </div>
  </>
}