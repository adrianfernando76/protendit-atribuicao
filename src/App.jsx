import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

const B = {
  bg:'#f0f2f5', card:'#fff', header:'#fff',
  border:'#e2e8f0', blue:'#1A3A5C', mid:'#2196F3',
  teal:'#26A69A', green:'#4CAF50', amber:'#F59E0B',
  text:'#1a202c', muted:'#718096', dim:'#cbd5e0',
}
const G = {
  projinternos:  {label:'Proj. Internos', cor:'#2196F3', bg:'#dbeafe', bd:'#93c5fd'},
  verificadores: {label:'Verificadores',  cor:'#26A69A', bg:'#ccfbf1', bd:'#6ee7b7'},
  projexternos:  {label:'Proj. Externos', cor:'#4CAF50', bg:'#dcfce7', bd:'#86efac'},
}

export default function App() {
  const [pessoas, setPessoas]     = useState([])
  const [contratos, setContratos] = useState([])
  const [vinculos, setVinculos]   = useState([])
  const [sel, setSel]             = useState(null)
  const [openCts, setOpenCts]     = useState([])
  const [modal, setModal]         = useState(null)
  const [showDash, setShowDash]   = useState(false)
  const [filterImp, setFilterImp] = useState(false)
  const [filterCt, setFilterCt]   = useState('')
  const [filterGrp, setFilterGrp] = useState({projinternos:'',verificadores:'',projexternos:''})
  const [arrows, setArrows]       = useState([])
  const boardRef = useRef(null)
  const timerRef = useRef(null)

  const loadAll = useCallback(async () => {
    const [{ data: p }, { data: c }, { data: pc }, { data: v }] = await Promise.all([
      supabase.from('pessoas').select('*').order('criado_em'),
      supabase.from('contratos').select('*').order('criado_em'),
      supabase.from('pecas').select('*').order('ordem'),
      supabase.from('vinculos').select('*'),
    ])
    setPessoas(p || [])
    setContratos((c||[]).map(ct => ({...ct, pecas:(pc||[]).filter(p=>p.contrato_id===ct.id)})))
    setVinculos(v || [])
  }, [])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => {
    const ch = supabase.channel('rt')
      .on('postgres_changes',{event:'*',schema:'public',table:'pessoas'},loadAll)
      .on('postgres_changes',{event:'*',schema:'public',table:'contratos'},loadAll)
      .on('postgres_changes',{event:'*',schema:'public',table:'pecas'},loadAll)
      .on('postgres_changes',{event:'*',schema:'public',table:'vinculos'},loadAll)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }, [loadAll])

  function sched() {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(calc, 100)
  }
  useEffect(() => { sched() }, [sel, openCts, vinculos])
  useEffect(() => { window.addEventListener('resize', sched); return () => window.removeEventListener('resize', sched) }, [])

  function calc() {
    if (!boardRef.current || !sel) { setArrows([]); return }
    const rect = boardRef.current.getBoundingClientRect()
    const res = []
    vinculos.filter(v => v.pessoa_id === sel).forEach(v => {
      const pEl = document.getElementById('p-'+sel)
      const pcEl = document.getElementById('pec-'+v.peca_id)
      if (!pEl || !pcEl) return
      const pR = pEl.getBoundingClientRect()
      const pcR = pcEl.getBoundingClientRect()
      res.push({
        x1: pR.right - rect.left, y1: pR.top + pR.height/2 - rect.top,
        x2: pcR.left - rect.left, y2: pcR.top + pcR.height/2 - rect.top,
      })
    })
    setArrows(res)
  }

  function pLinks(pid) {
    return vinculos.filter(v => v.pessoa_id === pid).map(v => {
      for (const ct of contratos) {
        const pc = ct.pecas.find(p => p.id === v.peca_id)
        if (pc) return {label:`${ct.etapa} / ${pc.nome}`, vid:v.id}
      }
      return null
    }).filter(Boolean)
  }

  function clickPessoa(pid) {
    if (sel === pid) { setSel(null); setOpenCts([]); return }
    setSel(pid)
    const ids = [...new Set(vinculos.filter(v => v.pessoa_id === pid).map(v => {
      for (const ct of contratos) {
        if (ct.pecas.find(p => p.id === v.peca_id)) return ct.id
      }
      return null
    }).filter(Boolean))]
    setOpenCts(ids)
    setTimeout(sched, 150)
  }

  function clickCt(id) {
    setOpenCts(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
    setTimeout(sched, 150)
  }

  async function toggleLink(pecaId) {
    if (!sel) return
    const ex = vinculos.find(v => v.pessoa_id === sel && v.peca_id === pecaId)
    if (ex) {
      setVinculos(p => p.filter(v => v.id !== ex.id))
      await supabase.from('vinculos').delete().eq('id', ex.id)
    } else {
      setVinculos(p => [...p, {pessoa_id:sel, peca_id:pecaId, id:'t'+Date.now()}])
      await supabase.from('vinculos').insert({pessoa_id:sel, peca_id:pecaId})
    }
    setTimeout(sched, 150)
  }

  async function remVinculo(vid, e) {
    e.stopPropagation()
    setVinculos(p => p.filter(v => v.id !== vid))
    await supabase.from('vinculos').delete().eq('id', vid)
    setTimeout(sched, 150)
  }

  async function toggleImp(id, e) {
    e.stopPropagation()
    const ct = contratos.find(c => c.id === id)
    if (!ct) return
    const val = !ct.importante
    setContratos(p => p.map(c => c.id === id ? {...c, importante:val} : c))
    await supabase.from('contratos').update({importante:val}).eq('id', id)
  }

  async function savePessoa(nome, grupo) {
    if (!nome.trim()) return
    await supabase.from('pessoas').insert({nome:nome.trim(), grupo, pos_x:0, pos_y:0})
    setModal(null)
  }

  async function saveCt(num, etapa, pecasStr) {
    if (!num.trim() || !etapa.trim()) return
    const {data:ct} = await supabase.from('contratos').insert({num:num.trim(), etapa:etapa.trim(), pos_x:0, pos_y:0, importante:false}).select().single()
    const ns = pecasStr.split(',').map(s => s.trim()).filter(Boolean)
    if (ns.length) await supabase.from('pecas').insert(ns.map((n,i) => ({contrato_id:ct.id, nome:n, ordem:i})))
    setModal(null)
  }

  async function editPessoa(id, nome, grupo) {
    if (!nome.trim()) return
    setPessoas(p => p.map(x => x.id === id ? {...x, nome:nome.trim(), grupo} : x))
    await supabase.from('pessoas').update({nome:nome.trim(), grupo}).eq('id', id)
    setModal(null)
  }

  async function editCt(id, num, etapa) {
    if (!num.trim() || !etapa.trim()) return
    setContratos(p => p.map(c => c.id === id ? {...c, num:num.trim(), etapa:etapa.trim()} : c))
    await supabase.from('contratos').update({num:num.trim(), etapa:etapa.trim()}).eq('id', id)
    setModal(null)
  }

  async function addPeca(ctId, nome) {
    if (!nome.trim()) return
    const ct = contratos.find(c => c.id === ctId)
    const {data:pc} = await supabase.from('pecas').insert({contrato_id:ctId, nome:nome.trim(), ordem:ct?.pecas.length||0}).select().single()
    setContratos(p => p.map(c => c.id === ctId ? {...c, pecas:[...c.pecas, pc]} : c))
  }

  async function delPeca(ctId, pcId) {
    setContratos(p => p.map(c => c.id === ctId ? {...c, pecas:c.pecas.filter(x => x.id !== pcId)} : c))
    setVinculos(p => p.filter(v => v.peca_id !== pcId))
    await supabase.from('pecas').delete().eq('id', pcId)
  }

  async function delPessoa(id) {
    setPessoas(p => p.filter(x => x.id !== id))
    setVinculos(p => p.filter(v => v.pessoa_id !== id))
    if (sel === id) { setSel(null); setOpenCts([]) }
    await supabase.from('pessoas').delete().eq('id', id)
  }

  async function delCt(id) {
    const ids = contratos.find(c => c.id === id)?.pecas.map(p => p.id) || []
    setContratos(p => p.filter(c => c.id !== id))
    setVinculos(p => p.filter(v => !ids.includes(v.peca_id)))
    await supabase.from('contratos').delete().eq('id', id)
  }

  async function exportPDF() {
    const {jsPDF} = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js')
    const doc = new jsPDF({orientation:'landscape', unit:'mm', format:'a4'})
    doc.setFont('helvetica','bold'); doc.setFontSize(16)
    doc.text('Atribuição de Peças — Protendit', 14, 15)
    doc.setFont('helvetica','normal'); doc.setFontSize(10)
    doc.text('Gerado em '+new Date().toLocaleDateString('pt-BR'), 14, 22)
    let y = 32
    Object.keys(G).forEach(grp => {
      const lista = pessoas.filter(p => p.grupo === grp)
      if (!lista.length) return
      doc.setFont('helvetica','bold'); doc.setFontSize(11)
      doc.text(G[grp].label, 14, y); y += 6
      lista.forEach(p => {
        const links = pLinks(p.id)
        doc.setFont('helvetica','bold'); doc.setFontSize(10)
        doc.text('• '+p.nome, 18, y); y += 5
        links.forEach(l => { doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.text('  — '+l.label, 22, y); y += 4 })
        if (!links.length) { doc.setFont('helvetica','italic'); doc.text('  sem vínculos', 22, y); y += 4 }
        if (y > 185) { doc.addPage(); y = 20 }
      }); y += 4
    })
    doc.save('atribuicao-protendit.pdf')
  }

  const dash = {
    totalP: pessoas.length, totalC: contratos.length, totalV: vinculos.length,
    porGrupo: Object.keys(G).map(g => ({
      label: G[g].label, cor: G[g].cor,
      count: pessoas.filter(p => p.grupo === g).length,
      vc: vinculos.filter(v => pessoas.find(p => p.id === v.pessoa_id && p.grupo === g)).length
    })),
    semV: pessoas.filter(p => !vinculos.some(v => v.pessoa_id === p.id)).length,
    top: pessoas.map(p => ({nome:p.nome, n:vinculos.filter(v => v.pessoa_id === p.id).length})).sort((a,b) => b.n-a.n).slice(0,5)
  }

  const ctsF = contratos.filter(ct =>
    (!filterImp || ct.importante) &&
    (!filterCt || ct.num.toLowerCase().includes(filterCt.toLowerCase()) || ct.etapa.toLowerCase().includes(filterCt.toLowerCase()))
  )

  const btn  = {fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid '+B.border,background:'transparent',color:B.muted,cursor:'pointer'}
  const btnB = {fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid '+B.mid,background:B.mid+'15',color:B.mid,cursor:'pointer'}
  const btnG = {fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid '+B.green,background:B.green+'15',color:B.green,cursor:'pointer'}
  const btnA = (a) => ({fontSize:11,padding:'4px 9px',borderRadius:6,border:'1px solid '+(a?B.mid:B.border),background:a?B.mid+'15':'transparent',color:a?B.mid:B.muted,cursor:'pointer'})
  const inp  = {width:'100%',marginBottom:8,background:'#fff',border:'1px solid '+B.border,color:B.text,borderRadius:6,padding:'7px 10px',fontSize:12,outline:'none'}

  return (
    <div style={{background:B.bg,width:'100vw',height:'100vh',fontFamily:"'Segoe UI',sans-serif",fontSize:13,color:B.text,display:'flex',flexDirection:'column',overflow:'hidden',position:'fixed',top:0,left:0}}>

      {/* TOPBAR */}
      <div style={{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',borderBottom:'1px solid '+B.border,background:B.header,zIndex:100,flexShrink:0,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:7,marginRight:8}}>
          <div style={{width:28,height:28,background:'linear-gradient(135deg,'+B.blue+','+B.mid+')',borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:14,color:'#fff'}}>P</div>
          <div>
            <div style={{fontWeight:700,fontSize:13,lineHeight:1.2}}>Atribuição de Peças</div>
            <div style={{fontSize:9,color:B.muted}}>Protendit Construções</div>
          </div>
        </div>
        <button style={btnA(filterImp)} onClick={() => setFilterImp(p => !p)}>⭐ Importantes</button>
        <input style={{...btn,width:150,outline:'none'}} placeholder="🔍 Buscar contrato..." value={filterCt} onChange={e => setFilterCt(e.target.value)}/>
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          <button style={btn} onClick={() => setModal({type:'add-pessoa'})}>+ Pessoa</button>
          <button style={btnG} onClick={() => setModal({type:'add-ct'})}>+ Contrato</button>
          <button style={btn} onClick={() => setShowDash(true)}>📊</button>
          <button style={btn} onClick={exportPDF}>⬇ PDF</button>
        </div>
      </div>

      {/* BOARD */}
      <div ref={boardRef} style={{flex:1,display:'grid',gridTemplateColumns:'1fr 1fr 1fr 3fr',overflow:'hidden',position:'relative'}}>

        {/* SVG SETAS */}
        <svg style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:50,overflow:'visible'}}>
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M2 1L8 5L2 9" fill="none" stroke={B.teal} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </marker>
          </defs>
          {arrows.map((a,i) => {
            const mx = (a.x1+a.x2)/2
            return <path key={i} d={'M'+a.x1+' '+a.y1+' C'+mx+' '+a.y1+' '+mx+' '+a.y2+' '+a.x2+' '+a.y2} fill="none" stroke={B.teal} strokeWidth="1.5" opacity=".7" markerEnd="url(#arr)"/>
          })}
        </svg>

        {/* COLUNAS PESSOAS */}
        {['projinternos','verificadores','projexternos'].map(grp => {
          const g = G[grp]
          const fq = filterGrp[grp].toLowerCase()
          const bgCol = grp==='projinternos'?'#eef4ff':grp==='verificadores'?'#e6faf8':'#edfaee'
          const lista = pessoas.filter(p => p.grupo === grp && (!fq || p.nome.toLowerCase().includes(fq)))
          return (
            <div key={grp} style={{borderRight:'1px solid '+B.border,overflowY:'auto',display:'flex',flexDirection:'column',background:bgCol}}>
              <div style={{padding:'6px 8px',borderBottom:'1px solid '+B.border,background:'rgba(255,255,255,.8)',position:'sticky',top:0,zIndex:10}}>
                <div style={{fontSize:10,fontWeight:700,color:g.cor,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4}}>{g.label}</div>
                <input style={{width:'100%',fontSize:11,padding:'3px 7px',borderRadius:5,border:'1px solid '+B.border,outline:'none',background:'#fff'}}
                  placeholder="Filtrar..." value={filterGrp[grp]} onChange={e => setFilterGrp(p => ({...p,[grp]:e.target.value}))}/>
              </div>
              <div style={{padding:'6px',display:'flex',flexDirection:'column',gap:4}}>
                {lista.map(p => {
                  const isSel = sel === p.id
                  const links = pLinks(p.id)
                  return (
                    <div key={p.id} id={'p-'+p.id}
                      style={{background:'#fff',border:'1px solid '+(isSel?g.cor:B.border),borderRadius:8,padding:'7px 9px',cursor:'pointer',boxShadow:isSel?'0 0 0 2px '+g.cor+'33':'0 1px 3px rgba(0,0,0,.05)',transition:'all .15s'}}
                      onClick={() => clickPessoa(p.id)}>
                      <div style={{display:'flex',alignItems:'center',gap:3}}>
                        <span style={{fontWeight:600,fontSize:12,flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{p.nome}</span>
                        {!isSel && links.length > 0 && <span style={{fontSize:9,padding:'1px 4px',borderRadius:99,background:g.bg,color:g.cor,border:'1px solid '+g.bd,fontWeight:700,flexShrink:0}}>{links.length}</span>}
                        <span style={{color:B.muted,fontSize:11,cursor:'pointer',flexShrink:0}} onClick={e => {e.stopPropagation(); setModal({type:'edit-pessoa',data:p})}}>✎</span>
                        <span style={{color:B.muted,fontSize:14,cursor:'pointer',flexShrink:0}} onClick={e => {e.stopPropagation(); delPessoa(p.id)}}>×</span>
                      </div>
                      {isSel && links.length > 0 && (
                        <div style={{display:'flex',flexDirection:'column',gap:2,marginTop:5}}>
                          {links.map((l,i) => (
                            <span key={i} style={{fontSize:10,padding:'2px 6px',borderRadius:4,background:g.bg,color:g.cor,border:'1px solid '+g.bd,display:'flex',alignItems:'center',gap:3}}>
                              <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.label}</span>
                              <span style={{cursor:'pointer',fontWeight:700,opacity:.6,flexShrink:0}} onClick={e => remVinculo(l.vid, e)}>×</span>
                            </span>
                          ))}
                        </div>
                      )}
                      {isSel && links.length === 0 && <div style={{fontSize:10,color:B.dim,marginTop:4}}>sem vínculos</div>}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* COLUNA CONTRATOS */}
        <div style={{background:'#f5fbf8',borderLeft:'2px solid '+B.border,overflowY:'auto',padding:'6px'}}>
          <div style={{fontSize:10,fontWeight:700,color:B.teal,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:6,padding:'2px 4px',position:'sticky',top:0,background:'#f5fbf8',zIndex:10}}>
            Contratos / Etapas — {ctsF.length}
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:5,alignContent:'start'}}>
            {ctsF.map(ct => {
              const isOpen = openCts.includes(ct.id)
              const temV = ct.pecas.some(pc => vinculos.some(v => v.peca_id === pc.id))
              const isVinc = sel && ct.pecas.some(pc => vinculos.some(v => v.peca_id === pc.id && v.pessoa_id === sel))
              const numLabel = ct.num.toUpperCase().startsWith('CT') ? ct.num.toUpperCase() : 'CT '+ct.num.toUpperCase()
              return (
                <div key={ct.id} style={{background:'#fff',border:'1px solid '+(isVinc?B.teal:ct.importante?B.amber:B.border),borderRadius:9,overflow:'hidden',boxShadow:isVinc?'0 0 0 2px '+B.teal+'33':'0 1px 3px rgba(0,0,0,.06)',transition:'all .2s'}}>
                  <div style={{padding:'6px 8px',cursor:'pointer',background:temV?B.teal+'08':'#fff',borderBottom:isOpen?'1px solid '+B.border:'none'}}
                    onClick={() => clickCt(ct.id)}>
                    <div style={{display:'flex',alignItems:'center',gap:3,marginBottom:3}}>
                      <span style={{fontSize:9,color:B.dim,display:'inline-block',transition:'transform .2s',transform:isOpen?'rotate(90deg)':'none'}}>▶</span>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:700,fontSize:11,color:B.text,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ct.etapa.toUpperCase()}</div>
                        <div style={{fontSize:9,color:B.mid,fontWeight:600}}>{numLabel}</div>
                      </div>
                      <div style={{display:'flex',gap:2,flexShrink:0,alignItems:'center'}}>
                        {temV && <span style={{fontSize:9,padding:'1px 3px',borderRadius:99,background:B.teal+'20',color:B.teal,fontWeight:700}}>{ct.pecas.filter(pc => vinculos.some(v => v.peca_id === pc.id)).length}</span>}
                        <span style={{color:ct.importante?B.amber:B.dim,fontSize:11,cursor:'pointer'}} onClick={e => toggleImp(ct.id, e)}>{ct.importante?'★':'☆'}</span>
                        <span style={{color:B.muted,fontSize:10,cursor:'pointer'}} onClick={e => {e.stopPropagation(); setModal({type:'edit-ct',data:ct})}}>✎</span>
                        <span style={{color:B.muted,fontSize:10,cursor:'pointer'}} onClick={e => {e.stopPropagation(); setModal({type:'edit-pecas',data:ct})}}>+</span>
                        <span style={{color:B.muted,fontSize:12,cursor:'pointer'}} onClick={e => {e.stopPropagation(); delCt(ct.id)}}>×</span>
                      </div>
                    </div>
                    {!isOpen && (
                      <div style={{display:'flex',gap:2,flexWrap:'wrap',paddingLeft:12}}>
                        {ct.pecas.map(pc => {
                          const linked = vinculos.some(v => v.peca_id === pc.id)
                          const linkedSel = sel && vinculos.some(v => v.peca_id === pc.id && v.pessoa_id === sel)
                          return (
                            <span key={pc.id} style={{fontSize:9,padding:'1px 3px',borderRadius:3,background:linkedSel?B.teal+'30':linked?B.teal+'15':'#f0f0f0',color:linkedSel?B.teal:linked?B.teal:B.dim,fontWeight:700}}>
                              {pc.nome.slice(0,3).toUpperCase()}
                            </span>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  {isOpen && ct.pecas.map(pc => {
                    const linked = vinculos.some(v => v.peca_id === pc.id)
                    const linkedSel = sel && vinculos.some(v => v.peca_id === pc.id && v.pessoa_id === sel)
                    return (
                      <div key={pc.id} id={'pec-'+pc.id}
                        style={{padding:'5px 8px 5px 18px',borderBottom:'1px solid '+B.border,cursor:sel?'pointer':'default',background:linkedSel?B.teal+'12':linked?B.teal+'05':'transparent',color:linkedSel?B.teal:linked?B.teal:B.muted,display:'flex',alignItems:'center',gap:5,fontSize:11,transition:'background .1s'}}
                        onClick={() => toggleLink(pc.id)}>
                        <div style={{width:5,height:5,borderRadius:'50%',background:linkedSel?B.teal:linked?B.teal+'88':B.border,flexShrink:0}}/>
                        {pc.nome}
                        {linkedSel && <span style={{marginLeft:'auto',fontSize:10,color:B.teal,fontWeight:700}}>✓</span>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* DASHBOARD */}
      {showDash && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={() => setShowDash(false)}>
          <div style={{background:'#fff',border:'1px solid '+B.border,borderRadius:12,padding:22,width:480,boxShadow:'0 8px 32px rgba(0,0,0,.15)',maxHeight:'80vh',overflowY:'auto'}} onClick={e => e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontWeight:700,fontSize:15}}>Dashboard</div>
              <span style={{cursor:'pointer',fontSize:18,color:B.muted}} onClick={() => setShowDash(false)}>×</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14}}>
              {[{l:'Pessoas',v:dash.totalP,c:B.mid},{l:'Contratos',v:dash.totalC,c:B.teal},{l:'Vínculos',v:dash.totalV,c:B.green}].map((x,i) => (
                <div key={i} style={{background:B.bg,border:'1px solid '+B.border,borderRadius:10,padding:12,textAlign:'center'}}>
                  <div style={{fontSize:24,fontWeight:700,color:x.c}}>{x.v}</div>
                  <div style={{fontSize:11,color:B.muted,marginTop:2}}>{x.l}</div>
                </div>
              ))}
            </div>
            {dash.porGrupo.map((g,i) => (
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,marginBottom:6,padding:'7px 12px',background:B.bg,border:'1px solid '+B.border,borderRadius:8}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:g.cor}}/>
                <span style={{flex:1,fontSize:12,fontWeight:500}}>{g.label}</span>
                <span style={{fontSize:12,color:B.muted}}>{g.count} pessoas</span>
                <span style={{fontSize:12,fontWeight:600,color:g.cor}}>{g.vc} vínculos</span>
              </div>
            ))}
            <div style={{fontWeight:600,fontSize:11,margin:'12px 0 7px',color:B.muted}}>Mais atribuídos</div>
            {dash.top.map((p,i) => (
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:5,padding:'5px 12px',background:B.bg,border:'1px solid '+B.border,borderRadius:8}}>
                <span style={{fontSize:11,color:B.muted,width:14}}>{i+1}.</span>
                <span style={{flex:1,fontSize:12,fontWeight:500}}>{p.nome}</span>
                <span style={{fontSize:12,fontWeight:600,color:B.mid}}>{p.n} peças</span>
              </div>
            ))}
            {dash.semV > 0 && <div style={{marginTop:10,padding:'7px 12px',background:'#fff8e1',border:'1px solid #ffe082',borderRadius:8,fontSize:11,color:'#795548'}}>{dash.semV} pessoa(s) sem vínculo</div>}
          </div>
        </div>
      )}

      {/* MODAIS */}
      {modal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'}} onClick={() => setModal(null)}>
          <div style={{background:'#fff',border:'1px solid '+B.border,borderRadius:12,padding:22,width:360,boxShadow:'0 8px 32px rgba(0,0,0,.15)',maxHeight:'80vh',overflowY:'auto'}} onClick={e => e.stopPropagation()}>
            {(modal.type==='add-pessoa'||modal.type==='edit-pessoa') && <MPessoa title={modal.type==='add-pessoa'?'Nova pessoa':'Editar pessoa'} data={modal.data} onSave={modal.type==='add-pessoa'?savePessoa:(n,g)=>editPessoa(modal.data.id,n,g)} onClose={()=>setModal(null)} inp={inp} btn={btn} btnG={btnG}/>}
            {(modal.type==='add-ct'||modal.type==='edit-ct') && <MCt title={modal.type==='add-ct'?'Novo contrato':'Editar contrato'} data={modal.data} onSave={modal.type==='add-ct'?saveCt:(n,e)=>editCt(modal.data.id,n,e)} onClose={()=>setModal(null)} inp={inp} btn={btn} btnB={btnB} muted={B.muted}/>}
            {modal.type==='edit-pecas' && <MPecas ct={modal.data} onAdd={addPeca} onDel={delPeca} onClose={()=>setModal(null)} inp={inp} btn={btn} btnG={btnG} muted={B.muted}/>}
          </div>
        </div>
      )}
    </div>
  )
}

function MPessoa({title,data,onSave,onClose,inp,btn,btnG}){
  const [nome,setNome]=useState(data?.nome||'')
  const [grupo,setGrupo]=useState(data?.grupo||'projinternos')
  return <>
    <div style={{fontWeight:700,marginBottom:14,fontSize:14}}>{title}</div>
    <input style={inp} value={nome} onChange={e=>setNome(e.target.value)} placeholder="Nome" autoFocus/>
    <select style={inp} value={grupo} onChange={e=>setGrupo(e.target.value)}>
      <option value="projinternos">Proj. Internos</option>
      <option value="verificadores">Verificadores</option>
      <option value="projexternos">Proj. Externos</option>
    </select>
    <div style={{display:'flex',gap:8}}>
      <button style={btn} onClick={onClose}>Cancelar</button>
      <button style={btnG} onClick={()=>onSave(nome,grupo)}>Salvar</button>
    </div>
  </>
}

function MCt({title,data,onSave,onClose,inp,btn,btnB,muted}){
  const [num,setNum]=useState(data?.num||'')
  const [etapa,setEtapa]=useState(data?.etapa||'')
  const [pecas,setPecas]=useState('')
  return <>
    <div style={{fontWeight:700,marginBottom:14,fontSize:14}}>{title}</div>
    <input style={inp} value={num} onChange={e=>setNum(e.target.value)} placeholder="Número (ex: 2455)" autoFocus/>
    <input style={inp} value={etapa} onChange={e=>setEtapa(e.target.value)} placeholder="Etapa (ex: Unicev)"/>
    {!data&&<>
      <input style={inp} value={pecas} onChange={e=>setPecas(e.target.value)} placeholder="Pilar, Viga, Terça, Patrão"/>
      <div style={{fontSize:10,color:muted,marginBottom:8,marginTop:-4}}>Tipos de peça separados por vírgula</div>
    </>}
    <div style={{display:'flex',gap:8}}>
      <button style={btn} onClick={onClose}>Cancelar</button>
      <button style={btnB} onClick={()=>onSave(num,etapa,pecas)}>Salvar</button>
    </div>
  </>
}

function MPecas({ct,onAdd,onDel,onClose,inp,btn,btnG,muted}){
  const [nova,setNova]=useState('')
  return <>
    <div style={{fontWeight:700,marginBottom:4,fontSize:14}}>Peças — {ct.etapa}</div>
    <div style={{fontSize:11,color:muted,marginBottom:12}}>Clique × para remover</div>
    <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:12,maxHeight:200,overflowY:'auto'}}>
      {ct.pecas.map(pc=>(
        <div key={pc.id} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 8px',background:'#f8f9fa',borderRadius:6,border:'1px solid #e2e8f0'}}>
          <span style={{flex:1,fontSize:12}}>{pc.nome}</span>
          <span style={{cursor:'pointer',color:'#999',fontWeight:700,fontSize:14}} onClick={()=>onDel(ct.id,pc.id)}>×</span>
        </div>
      ))}
      {!ct.pecas.length&&<div style={{fontSize:11,color:muted}}>Nenhuma peça</div>}
    </div>
    <div style={{display:'flex',gap:6,marginBottom:12}}>
      <input style={{...inp,marginBottom:0,flex:1}} value={nova} onChange={e=>setNova(e.target.value)} placeholder="Nova peça..."
        onKeyDown={e=>{if(e.key==='Enter'&&nova.trim()){onAdd(ct.id,nova);setNova('')}}}/>
      <button style={btnG} onClick={()=>{if(nova.trim()){onAdd(ct.id,nova);setNova('')}}}>+ Add</button>
    </div>
    <button style={btn} onClick={onClose}>Fechar</button>
  </>
}