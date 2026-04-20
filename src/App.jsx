import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

const BRAND = {
  bg:        '#ffffff',
  bgCard:    '#f8f9fa',
  bgHeader:  '#f1f3f5',
  border:    '#dee2e6',
  green:     '#4CAF50',
  blue:      '#1A3A5C',
  blueMid:   '#2196F3',
  teal:      '#26A69A',
  text:      '#212529',
  textMuted: '#6c757d',
  textDim:   '#adb5bd',
}

const GRUPOS = {
  projinternos:  { label: 'Proj. Internos',  cor: '#2196F3', bg: '#e3f2fd', bd: '#90caf9' },
  verificadores: { label: 'Verificadores',   cor: '#26A69A', bg: '#e0f2f1', bd: '#80cbc4' },
  projexternos:  { label: 'Proj. Externos',  cor: '#4CAF50', bg: '#e8f5e9', bd: '#a5d6a7' },
}

const SNAP = 8

export default function App() {
  const [pessoas, setPessoas]     = useState([])
  const [contratos, setContratos] = useState([])
  const [vinculos, setVinculos]   = useState([])
  const [sel, setSel]             = useState([])
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
    const sl = canvasRef.current.scrollLeft
    const st = canvasRef.current.scrollTop
    const boxes = []
    canvasRef.current.querySelectorAll('.draggable').forEach(el => {
      const r = el.getBoundingClientRect()
      boxes.push({ id: el.id, x: r.left - rect.left + sl, y: r.top - rect.top + st, w: r.width, h: r.height })
    })
    const result = []
    vinculos.forEach(v => {
      const pEl = document.getElementById('card-' + v.pessoa_id)
      const pcEl = document.getElementById('pec-' + v.peca_id)
      if (!pEl || !pcEl) return
      const pR = pEl.getBoundingClientRect()
      const pcR = pcEl.getBoundingClientRect()
      const x1 = pR.right - rect.left + sl
      const y1 = pR.top + pR.height / 2 - rect.top + st
      const x2 = pcR.left - rect.left + sl
      const y2 = pcR.top + pcR.height / 2 - rect.top + st
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
        if (pc) return { label: `${ct.num} ${ct.etapa} / ${pc.nome}`, vinculoId: v.id }
      }
      return null
    }).filter(Boolean)
  }

  async function removeVinculo(vinculoId, e) {
    e.stopPropagation()
    setVinculos(prev => prev.filter(v => v.id !== vinculoId))
    await supabase.from('vinculos').delete().eq('id', vinculoId)
  }

  async function toggleLink(pecaId) {
    if (!sel.length) return
    const pessoaId = sel[sel.length - 1]
    const exists = vinculos.find(v => v.pessoa_id === pessoaId && v.peca_id === pecaId)
    if (exists) {
      setVinculos(prev => prev.filter(v => v.id !== exists.id))
      await supabase.from('vinculos').delete().eq('id', exists.id)
    } else {
      const novo = { pessoa_id: pessoaId, peca_id: pecaId, id: 'tmp-' + Date.now() }
      setVinculos(prev => [...prev, novo])
      await supabase.from('vinculos').insert({ pessoa_id: pessoaId, peca_id: pecaId })
    }
  }

  function toggleSel(id, e) {
    if (e.ctrlKey || e.metaKey) {
      setSel(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id])
    } else {
      setSel(prev => prev.length === 1 && prev[0] === id ? [] : [id])
    }
  }

  function cardHeightPessoa(p) {
    const tags = pessoaLinks(p.id).length
    return 68 + (tags > 0 ? tags * 22 : 18)
  }

  function cardHeightCt(ct) {
    return 52 + ct.pecas.length * 30
  }

  async function savePessoa(nome, grupo) {
    if (!nome.trim()) return
    const lista = pessoas.filter(p => p.grupo === grupo)
    const lastY = lista.length ? Math.max(...lista.map(p => p.pos_y || 0)) + 110 : 20
    setPessoas(prev => [...prev, { id: 'tmp-' + Date.now(), nome: nome.trim(), grupo, pos_x: 20, pos_y: lastY, criado_em: new Date().toISOString() }])
    await supabase.from('pessoas').insert({ nome: nome.trim(), grupo, pos_x: 20, pos_y: lastY })
    setModal(null)
  }

  async function saveContrato(num, etapa, pecasStr) {
    if (!num.trim() || !etapa.trim()) return
    const px = 650 + contratos.length * 185
    const { data: ct } = await supabase.from('contratos').insert({ num: num.trim(), etapa: etapa.trim(), pos_x: px, pos_y: 20 }).select().single()
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
    setSel(prev => prev.filter(s => s !== id))
    await supabase.from('pessoas').delete().eq('id', id)
  }

  async function delContrato(id) {
    const pcIds = contratos.find(c => c.id === id)?.pecas.map(p => p.id) || []
    setContratos(prev => prev.filter(c => c.id !== id))
    setVinculos(prev => prev.filter(v => !pcIds.includes(v.peca_id)))
    await supabase.from('contratos').delete().eq('id', id)
  }

  async function autoOrganize(onlySelected = false) {
    const GAP_Y = 14, START_X = 20, START_Y = 20
    const grpOrder = ['projinternos', 'verificadores', 'projexternos']
    let y = START_Y
    const updates = []

    grpOrder.forEach(grp => {
      const lista = pessoas.filter(p => p.grupo === grp && (!onlySelected || sel.includes(p.id)))
      lista.forEach(p => {
        updates.push({ table: 'pessoas', id: p.id, pos_x: START_X, pos_y: y })
        y += cardHeightPessoa(p) + GAP_Y
      })
      if (lista.length) y += 20
    })

    const ctList = contratos.filter(ct => !onlySelected || sel.includes(ct.id))
    let ctY = START_Y
    ctList.forEach((ct, i) => {
      const col = Math.floor(i / 6)
      const row = i % 6
      if (row === 0) ctY = START_Y
      updates.push({ table: 'contratos', id: ct.id, pos_x: 680 + col * 185, pos_y: ctY })
      ctY += cardHeightCt(ct) + GAP_Y
    })

    setPessoas(prev => prev.map(p => { const u = updates.find(u => u.table === 'pessoas' && u.id === p.id); return u ? { ...p, pos_x: u.pos_x, pos_y: u.pos_y } : p }))
    setContratos(prev => prev.map(c => { const u = updates.find(u => u.table === 'contratos' && u.id === c.id); return u ? { ...c, pos_x: u.pos_x, pos_y: u.pos_y } : c }))

    setTimeout(() => {
      updates.forEach(u => { const el = document.getElementById('card-' + u.id); if (el) { el.style.left = u.pos_x + 'px'; el.style.top = u.pos_y + 'px' } })
      scheduleArrows()
    }, 30)

    for (const u of updates) await supabase.from(u.table).update({ pos_x: u.pos_x, pos_y: u.pos_y }).eq('id', u.id)
  }

  function startDrag(e, id) {
    if (e.button !== 0) return
    const dragIds = sel.includes(id) && sel.length > 1 ? sel : [id]
    const offsets = dragIds.map(did => {
      const el = document.getElementById('card-' + did)
      return { id: did, el, startL: parseFloat(el?.style.left) || 0, startT: parseFloat(el?.style.top) || 0 }
    })
    dragRef.current = { ids: dragIds, offsets, startX: e.clientX, startY: e.clientY, moved: false }
    e.preventDefault()
    e.stopPropagation()
  }

  useEffect(() => {
    const mm = e => {
      if (!dragRef.current) return
      const { offsets, startX, startY } = dragRef.current
      const dx = e.clientX - startX, dy = e.clientY - startY
      const newGuides = []
      const allCards = [...pessoas, ...contratos]
      offsets.forEach(o => {
        let nx = Math.max(0, o.startL + dx)
        let ny = Math.max(0, o.startT + dy)
        if (offsets.length === 1) {
          allCards.forEach(item => {
            if (item.id === o.id) return
            const ox = item.pos_x || 0, oy = item.pos_y || 0
            if (Math.abs(ny - oy) < SNAP) { ny = oy; newGuides.push({ type: 'h', y: oy }) }
            if (Math.abs(nx - ox) < SNAP) { nx = ox; newGuides.push({ type: 'v', x: ox }) }
          })
        }
        if (o.el) { o.el.style.left = nx + 'px'; o.el.style.top = ny + 'px' }
        o.nx = nx; o.ny = ny
      })
      dragRef.current.moved = true
      setGuides(newGuides)
      scheduleArrows()
    }
    const mu = async () => {
      if (!dragRef.current) return
      const { offsets, moved } = dragRef.current
      dragRef.current = null; setGuides([])
      if (!moved) return
      for (const o of offsets) {
        if (o.nx === undefined) continue
        const isPessoa = pessoas.some(p => p.id === o.id)
        const table = isPessoa ? 'pessoas' : 'contratos'
        if (isPessoa) setPessoas(prev => prev.map(p => p.id === o.id ? { ...p, pos_x: o.nx, pos_y: o.ny } : p))
        else setContratos(prev => prev.map(c => c.id === o.id ? { ...c, pos_x: o.nx, pos_y: o.ny } : c))
        await supabase.from(table).update({ pos_x: o.nx, pos_y: o.ny }).eq('id', o.id)
      }
    }
    window.addEventListener('mousemove', mm)
    window.addEventListener('mouseup', mu)
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu) }
  }, [pessoas, contratos, sel])

  const isSel = id => sel.includes(id)

  const s = {
    app: { background: BRAND.bg, width: '100vw', height: '100vh', fontFamily: "'Segoe UI', sans-serif", fontSize: 13, color: BRAND.text, display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'fixed', top: 0, left: 0 },
    topbar: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 20px', borderBottom: `1px solid ${BRAND.border}`, background: BRAND.bgHeader, zIndex: 100, flexShrink: 0 },
    canvasWrap: { flex: 1, overflow: 'auto', position: 'relative' },
    canvas: { position: 'relative', width: 4000, height: 3000 },
    card: (id) => ({ background: BRAND.bgCard, border: `1px solid ${isSel(id) ? BRAND.blueMid : BRAND.border}`, boxShadow: isSel(id) ? `0 0 0 2px ${BRAND.blueMid}33` : '0 1px 3px rgba(0,0,0,.06)', borderRadius: 10, padding: '10px 12px', width: 190 }),
    ctCard: (id) => ({ background: BRAND.bgCard, border: `1px solid ${isSel(id) ? BRAND.blueMid : BRAND.border}`, boxShadow: isSel(id) ? `0 0 0 2px ${BRAND.blueMid}33` : '0 1px 3px rgba(0,0,0,.06)', borderRadius: 10, width: 165, overflow: 'hidden' }),
    btn: { fontSize: 12, padding: '5px 12px', borderRadius: 6, border: `1px solid ${BRAND.border}`, background: 'transparent', color: BRAND.textMuted, cursor: 'pointer' },
    btnBlue: { fontSize: 12, padding: '5px 12px', borderRadius: 6, border: `1px solid ${BRAND.blueMid}`, background: `${BRAND.blueMid}15`, color: BRAND.blueMid, cursor: 'pointer' },
    btnGreen: { fontSize: 12, padding: '5px 12px', borderRadius: 6, border: `1px solid ${BRAND.green}`, background: `${BRAND.green}15`, color: BRAND.green, cursor: 'pointer' },
    handle: { cursor: 'grab', color: BRAND.textDim, fontSize: 14, padding: '0 4px', userSelect: 'none' },
    peca: (linked) => ({ padding: '6px 10px', borderBottom: `1px solid ${BRAND.border}`, cursor: 'pointer', background: linked ? '#e8f5e9' : 'transparent', color: linked ? BRAND.teal : BRAND.textMuted, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12 }),
    dot: (linked) => ({ width: 6, height: 6, borderRadius: '50%', background: linked ? BRAND.teal : BRAND.border, flexShrink: 0 }),
    modal: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' },
    modalBox: { background: '#fff', border: `1px solid ${BRAND.border}`, borderRadius: 12, padding: 24, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,.12)' },
    inp: { width: '100%', marginBottom: 8, background: '#fff', border: `1px solid ${BRAND.border}`, color: BRAND.text, borderRadius: 6, padding: '8px 10px', fontSize: 12, outline: 'none' },
  }

  return (
    <div style={s.app} onClick={() => setSel([])}>
      <div style={s.topbar} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, background: `linear-gradient(135deg, ${BRAND.blue}, ${BRAND.blueMid})`, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 15, color: '#fff' }}>P</div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 14, color: BRAND.text }}>Atribuição de Peças</div>
            <div style={{ fontSize: 10, color: BRAND.textMuted }}>Protendit Construções</div>
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {sel.length > 0 && <button style={s.btnBlue} onClick={() => autoOrganize(true)}>⊞ Organizar selecionados ({sel.length})</button>}
          <button style={s.btn} onClick={() => autoOrganize(false)}>⊞ Organizar tudo</button>
          <button style={s.btn} onClick={() => setModal({ type: 'add-pessoa' })}>+ Pessoa</button>
          <button style={s.btnGreen} onClick={() => setModal({ type: 'add-contrato' })}>+ Contrato / Etapa</button>
        </div>
      </div>

      <div style={s.canvasWrap} ref={canvasRef}>
        <div style={s.canvas}>
          {guides.map((g, i) =>
            g.type === 'h'
              ? <div key={i} style={{ position: 'absolute', left: 0, top: g.y, width: '100%', height: 1, background: BRAND.blueMid, opacity: 0.4, zIndex: 50, pointerEvents: 'none' }} />
              : <div key={i} style={{ position: 'absolute', top: 0, left: g.x, width: 1, height: '100%', background: BRAND.blueMid, opacity: 0.4, zIndex: 50, pointerEvents: 'none' }} />
          )}

          <svg style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1, overflow: 'visible' }}>
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M2 1L8 5L2 9" fill="none" stroke={BRAND.teal} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>
            {arrows.map((a, i) => {
              const d = a.safeY !== null
                ? `M${a.x1} ${a.y1} C${a.midX} ${a.y1} ${a.midX} ${a.safeY} ${a.midX} ${a.safeY} C${a.midX} ${a.safeY} ${a.midX} ${a.y2} ${a.x2} ${a.y2}`
                : `M${a.x1} ${a.y1} C${a.midX} ${a.y1} ${a.midX} ${a.y2} ${a.x2} ${a.y2}`
              return <path key={i} d={d} fill="none" stroke={BRAND.teal} strokeWidth="1.5" opacity="0.7" markerEnd="url(#arr)" />
            })}
          </svg>

          {pessoas.map(p => {
            const grp = GRUPOS[p.grupo] || GRUPOS.projinternos
            const links = pessoaLinks(p.id)
            return (
              <div key={p.id} id={'card-' + p.id} className="draggable"
                style={{ position: 'absolute', left: p.pos_x || 20, top: p.pos_y || 20, zIndex: 10 }}
                onClick={e => { e.stopPropagation(); toggleSel(p.id, e) }}>
                <div style={s.card(p.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                    <span style={s.handle} onMouseDown={e => { e.stopPropagation(); startDrag(e, p.id) }}>⠿</span>
                    <span style={{ fontWeight: 600, color: BRAND.text, flex: 1, fontSize: 13 }}>{p.nome}</span>
                    <span style={{ color: BRAND.textMuted, fontSize: 12, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); setModal({ type: 'edit-pessoa', data: p }) }}>✎</span>
                    <span style={{ color: BRAND.textMuted, fontSize: 16, cursor: 'pointer' }} onClick={e => { e.stopPropagation(); delPessoa(p.id) }}>×</span>
                  </div>
                  <div style={{ fontSize: 10, color: grp.cor, fontWeight: 600, marginBottom: 5 }}>{grp.label}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    {links.length > 0
                      ? links.map((t, i) => (
                        <span key={i} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4, background: grp.bg, color: grp.cor, border: `1px solid ${grp.bd}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{t.label}</span>
                          <span style={{ cursor: 'pointer', fontWeight: 700, fontSize: 12, flexShrink: 0, opacity: 0.6 }} onClick={e => removeVinculo(t.vinculoId, e)}>×</span>
                        </span>
                      ))
                      : <span style={{ fontSize: 10, color: BRAND.textDim }}>sem vínculos</span>}
                  </div>
                </div>
              </div>
            )
          })}

          {contratos.map(ct => (
            <div key={ct.id} id={'card-' + ct.id} className="draggable"
              style={{ position: 'absolute', left: ct.pos_x || 650, top: ct.pos_y || 20, zIndex: 10 }}
              onClick={e => { e.stopPropagation(); toggleSel(ct.id, e) }}>
              <div style={s.ctCard(ct.id)}>
                <div style={{ padding: '8px 10px', background: BRAND.bgHeader, borderBottom: `1px solid ${BRAND.border}`, display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                  <span style={s.handle} onMouseDown={e => { e.stopPropagation(); startDrag(e, ct.id) }}>⠿</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 700, color: BRAND.blueMid, fontSize: 12, letterSpacing: '.04em' }}>
                      {ct.num.toUpperCase().startsWith('CT') ? ct.num.toUpperCase() : 'CT ' + ct.num.toUpperCase()}
                    </div>
                    <div style={{ fontWeight: 700, color: BRAND.text, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ct.etapa.toUpperCase()}</div>
                  </div>
                  <span style={{ color: BRAND.textMuted, fontSize: 12, cursor: 'pointer', flexShrink: 0 }} onClick={e => { e.stopPropagation(); setModal({ type: 'edit-contrato', data: ct }) }}>✎</span>
                  <span style={{ color: BRAND.textMuted, fontSize: 16, cursor: 'pointer', flexShrink: 0 }} onClick={e => { e.stopPropagation(); delContrato(ct.id) }}>×</span>
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
            {modal.type === 'add-contrato' && <ModalContrato title="Novo contrato / etapa" onSave={saveContrato} onClose={() => setModal(null)} s={s} brand={BRAND} />}
            {modal.type === 'edit-contrato' && <ModalContrato title="Editar contrato" data={modal.data} onSave={(n, e) => editContrato(modal.data.id, n, e)} onClose={() => setModal(null)} s={s} brand={BRAND} />}
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
    <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 14 }}>{title}</div>
    <input style={s.inp} value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome" autoFocus />
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

function ModalContrato({ title, data, onSave, onClose, s, brand }) {
  const [num, setNum] = useState(data?.num || '')
  const [etapa, setEtapa] = useState(data?.etapa || '')
  const [pecas, setPecas] = useState('')
  return <>
    <div style={{ fontWeight: 700, marginBottom: 14, fontSize: 14 }}>{title}</div>
    <input style={s.inp} value={num} onChange={e => setNum(e.target.value)} placeholder="Número (ex: 2455)" autoFocus />
    <input style={s.inp} value={etapa} onChange={e => setEtapa(e.target.value)} placeholder="Etapa (ex: Unicev)" />
    {!data && <>
      <input style={s.inp} value={pecas} onChange={e => setPecas(e.target.value)} placeholder="Pilar, Viga, Terça, Patrão" />
      <div style={{ fontSize: 10, color: brand?.textMuted, marginBottom: 8, marginTop: -4 }}>Tipos de peça separados por vírgula</div>
    </>}
    <div style={{ display: 'flex', gap: 8 }}>
      <button style={s.btn} onClick={onClose}>Cancelar</button>
      <button style={s.btnBlue} onClick={() => onSave(num, etapa, pecas)}>Salvar</button>
    </div>
  </>
}