import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

const BRAND = {
  bg:'#f0f2f5', bgCard:'#ffffff', bgHeader:'#ffffff',
  border:'#e2e8f0', blue:'#1A3A5C', blueMid:'#2196F3',
  teal:'#26A69A', green:'#4CAF50', amber:'#F59E0B',
  text:'#1a202c', textMuted:'#718096', textDim:'#cbd5e0',
}

const GRUPOS = {
  projinternos:  {label:'Proj. Internos', cor:'#2196F3', bg:'#dbeafe', bd:'#93c5fd'},
  verificadores: {label:'Verificadores',  cor:'#26A69A', bg:'#ccfbf1', bd:'#6ee7b7'},
  projexternos:  {label:'Proj. Externos', cor:'#4CAF50', bg:'#dcfce7', bd:'#86efac'},
}

export default function App() {
  const [pessoas, setPessoas]     = useState([])
  const [contratos, setContratos] = useState([])
  const [vinculos, setVinculos]   = useState([])
  const [selPessoa, setSelPessoa] = useState(null)
  const [openCts, setOpenCts]     = useState([])
  const [modal, setModal]         = useState(null)
  const [showDash, setShowDash]   = useState(false)
  const [filterImp, setFilterImp] = useState(false)
  const [filterGrp, setFilterGrp] = useState('todos')
  const [arrows, setArrows]       = useState([])
  const boardRef = useRef(null)
  const arrowTimer = useRef(null)

  const loadAll = useCallback(async () => {
    const [{ data: p }, { data: c }, { data: pc }, { data: v }] = await Promise.all([
      supabase.from('pessoas').select('*').order('criado_em'),
      supabase.from('contratos').select('*').order('criado_em'),
      supabase.from('pecas').select('*').order('ordem'),
      supabase.from('vinculos').select('*'),
    ])
    setPessoas(p || [])
    setContratos((c||[]).map(ct=>({...ct, pecas:(pc||[]).filter(p=>p.contrato_id===ct.id)})))
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

  function schedArrows() {
    if (arrowTimer.current) clearTimeout(arrowTimer.current)
    arrowTimer.current = setTimeout(calcArrows, 100)
  }

  useEffect(() => { schedArrows() }, [arrows.length, selPessoa, openCts, vinculos])
  useEffect(() => { window.addEventListener('resize', schedArrows); return () => window.removeEventListener('resize', schedArrows) }, [])

  function calcArrows() {
    if (!boardRef.current || !selPessoa) { setArrows([]); return }
    const rect = boardRef.current.getBoundingClientRect()
    const result = []
    vinculos.filter(v=>v.pessoa_id===selPessoa).forEach(v => {
      const pEl = document.getElementById('p-'+selPessoa)
      const pcEl = document.getElementById('pec-'+v.peca_id)
      if (!pEl||!pcEl) return
      const pR=pEl.getBoundingClientRect()
      const pcR=pcEl.getBoundingClientRect()
      result.push({
        x1: pR.right - rect.left,
        y1: pR.top + pR.height/2 - rect.top,
        x2: pcR.left - rect.left,
        y2: pcR.top + pcR.height/2 - rect.top,
      })
    })
    setArrows(result)
  }

  function pessoaLinks(pid) {
    return vinculos.filter(v=>v.pessoa_id===pid).map(v=>{
      for (const ct of contratos) {
        const pc=ct.pecas.find(p=>p.id===v.peca_id)
        if(pc) return {label:`${ct.num} ${ct.etapa} / ${pc.nome}`, vid:v.id, ctId:ct.id}
      }
      return null
    }).filter(Boolean)
  }

  function ctVinculosPessoa(ctId) {
    if (!selPessoa) return []
    return vinculos.filter(v=>v.pessoa_id===selPessoa).map(v=>{
      const ct = contratos.find(c=>c.id===ctId)
      if (!ct) return null
      const pc = ct.pecas.find(p=>p.id===v.peca_id)
      return pc ? pc.nome : null
    }).filter(Boolean)
  }

  function handleClickPessoa(pid) {
    if (selPessoa === pid) {
      setSelPessoa(null)
      setOpenCts([])
      setArrows([])
      return
    }
    setSelPessoa(pid)
    const ctIds = [...new Set(
      vinculos.filter(v=>v.pessoa_id===pid).map(v=>{
        for (const ct of contratos) {
          if (ct.pecas.find(p=>p.id===v.peca_id)) return ct.id
        }
        return null
      }).filter(Boolean)
    )]
    setOpenCts(ctIds)
    setTimeout(schedArrows, 120)
  }

  function handleClickCt(ctId) {
    setOpenCts(prev =>
      prev.includes(ctId) ? prev.filter(id=>id!==ctId) : [...prev, ctId]
    )
    if (selPessoa) setTimeout(schedArrows, 120)
  }

  async function toggleLink(pecaId) {
    if (!selPessoa) return
    const exists = vinculos.find(v=>v.pessoa_id===selPessoa&&v.peca_id===pecaId)
    if (exists) {
      setVinculos(prev=>prev.filter(v=>v.id!==exists.id))
      await supabase.from('vinculos').delete().eq('id',exists.id)
    } else {
      setVinculos(prev=>[...prev,{pessoa_id:selPessoa,peca_id:pecaId,id:'tmp-'+Date.now()}])
      await supabase.from('vinculos').insert({pessoa_id:selPessoa,peca_id:pecaId})
    }
    setTimeout(schedArrows, 120)
  }

  async function removeVinculo(vid, e) {
    e.stopPropagation()
    setVinculos(prev=>prev.filter(v=>v.id!==vid))
    await supabase.from('vinculos').delete().eq('id',vid)
    setTimeout(schedArrows, 120)
  }

  async function toggleImportante(id, e) {
    e.stopPropagation()
    const ct = contratos.find(c=>c.id===id)
    if (!ct) return
    const val = !ct.importante
    setContratos(prev=>prev.map(c=>c.id===id?{...c,importante:val}:c))
    await supabase.from('contratos').update({importante:val}).eq('id',id)
  }

  async function savePessoa(nome, grupo) {
    if (!nome.trim()) return
    await supabase.from('pessoas').insert({nome:nome.trim(),grupo,pos_x:0,pos_y:0})
    setModal(null)
  }

  async function saveContrato(num, etapa, pecasStr) {
    if (!num.trim()||!etapa.trim()) return
    const {data:ct} = await supabase.from('contratos').insert({num:num.trim(),etapa:etapa.trim(),pos_x:0,pos_y:0,importante:false}).select().single()
    const nomes = pecasStr.split(',').map(s=>s.trim()).filter(Boolean)
    if (nomes.length) await supabase.from('pecas').insert(nomes.map((nome,i)=>({contrato_id:ct.id,nome,ordem:i})))
    setModal(null)
  }

  async function editPessoa(id, nome, grupo) {
    if (!nome.trim()) return
    setPessoas(prev=>prev.map(p=>p.id===id?{...p,nome:nome.trim(),grupo}:p))
    await supabase.from('pessoas').update({nome:nome.trim(),grupo}).eq('id',id)
    setModal(null)
  }

  async function editContrato(id, num, etapa) {
    if (!num.trim()||!etapa.trim()) return
    setContratos(prev=>prev.map(c=>c.id===id?{...c,num:num.trim(),etapa:etapa.trim()}:c))
    await supabase.from('contratos').update({num:num.trim(),etapa:etapa.trim()}).eq('id',id)
    setModal(null)
  }

  async function addPecaContrato(ctId, nome) {
    if (!nome.trim()) return
    const ct = contratos.find(c=>c.id===ctId)
    const {data:pc} = await supabase.from('pecas').insert({contrato_id:ctId,nome:nome.trim(),ordem:ct?.pecas.length||0}).select().single()
    setContratos(prev=>prev.map(c=>c.id===ctId?{...c,pecas:[...c.pecas,pc]}:c))
  }

  async function delPeca(ctId, pcId) {
    setContratos(prev=>prev.map(c=>c.id===ctId?{...c,pecas:c.pecas.filter(p=>p.id!==pcId)}:c))
    setVinculos(prev=>prev.filter(v=>v.peca_id!==pcId))
    await supabase.from('pecas').delete().eq('id',pcId)
  }

  async function delPessoa(id) {
    setPessoas(prev=>prev.filter(p=>p.id!==id))
    setVinculos(prev=>prev.filter(v=>v.pessoa_id!==id))
    if (selPessoa===id) { setSelPessoa(null); setOpenCts([]) }
    await supabase.from('pessoas').delete().eq('id',id)
  }

  async function delContrato(id) {
    const pcIds = contratos.find(c=>c.id===id)?.pecas.map(p=>p.id)||[]
    setContratos(prev=>prev.filter(c=>c.id!==id))
    setVinculos(prev=>prev.filter(v=>!pcIds.includes(v.peca_id)))
    await supabase.from('contratos').delete().eq('id',id)
  }

  async function exportPDF() {
    const {jsPDF} = await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js')
    const doc = new jsPDF({orientation:'landscape',unit:'mm',format:'a4'})
    doc.setFont('helvetica','bold'); doc.setFontSize(16)
    doc.text('Atribuição de Peças — Protendit',14,15)
    doc.setFont('helvetica','normal'); doc.setFontSize(10)
    doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')}`,14,22)
    let y=32
    Object.keys(GRUPOS).forEach(grp=>{
      const lista=pessoas.filter(p=>p.grupo===grp)
      if(!lista.length) return
      doc.setFont('helvetica','bold'); doc.setFontSize(11)
      doc.text(GRUPOS[grp].label,14,y); y+=6
      lista.forEach(p=>{
        const links=pessoaLinks(p.id)
        doc.setFont('helvetica','bold'); doc.setFontSize(10)
        doc.text(`• ${p.nome}`,18,y); y+=5
        links.forEach(l=>{
          doc.setFont('helvetica','normal'); doc.setFontSize(9)
          doc.text(`  — ${l.label}`,22,y); y+=4
        })
        if(!links.length){doc.setFont('helvetica','italic');doc.text('  sem vínculos',22,y);y+=4}
        if(y>185){doc.addPage();y=20}
      })
      y+=4
    })
    doc.save('atribuicao-protendit.pdf')
  }

  const dash = {
    totalP:pessoas.length, totalC:contratos.length, totalV:vinculos.length,
    porGrupo:Object.keys(GRUPOS).map(g=>({
      label:GRUPOS[g].label, cor:GRUPOS[g].cor,
      count:pessoas.filter(p=>p.grupo===g).length,
      vc:vinculos.filter(v=>pessoas.find(p=>p.id===v.pessoa_id&&p.grupo===g)).length
    })),
    semVinculo:pessoas.filter(p=>!vinculos.some(v=>v.pessoa_id===p.id)).length,
    top:pessoas.map(p=>({nome:p.nome,n:vinculos.filter(v=>v.pessoa_id===p.id).length})).sort((a,b)=>b.n-a.n).slice(0,5)
  }

  const contratosF = contratos.filter(ct=>!filterImp||ct.importante)
  const pessoasF = pessoas.filter(p=>filterGrp==='todos'||p.grupo===filterGrp)

  const S = {
    btn:{fontSize:11,padding:'4px 9px',borderRadius:6,border:`1px solid ${BRAND.border}`,background:'transparent',color:BRAND.textMuted,cursor:'pointer'},
    btnB:{fontSize:11,padding:'4px 9px',borderRadius:6,border:`1px solid ${BRAND.blueMid}`,background:`${BRAND.blueMid}15`,color:BRAND.blueMid,cursor:'pointer'},
    btnG:{fontSize:11,padding:'4px 9px',borderRadius:6,border:`1px solid ${BRAND.green}`,background:`${BRAND.green}15`,color:BRAND.green,cursor:'pointer'},
    btnA:a=>({fontSize:11,padding:'4px 9px',borderRadius:6,border:`1px solid ${a?BRAND.blueMid:BRAND.border}`,background:a?`${BRAND.blueMid}15`:'transparent',color:a?BRAND.blueMid:BRAND.textMuted,cursor:'pointer'}),
    inp:{width:'100%',marginBottom:8,background:'#fff',border:`1px solid ${BRAND.border}`,color:BRAND.text,borderRadius:6,padding:'7px 10px',fontSize:12,outline:'none'},
    modal:{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'},
    mbox:{background:'#fff',border:`1px solid ${BRAND.border}`,borderRadius:12,padding:22,width:360,boxShadow:'0 8px 32px rgba(0,0,0,.15)',maxHeight:'80vh',overflowY:'auto'},
  }

  return (
    <div style={{background:BRAND.bg,width:'100vw',height:'100vh',fontFamily:"'Segoe UI',sans-serif",fontSize:13,color:BRAND.text,display:'flex',flexDirection:'column',overflow:'hidden',position:'fixed',top:0,left:0}}>

      {/* TOPBAR */}
      <div style={{display:'flex',alignItems:'center',gap:6,padding:'8px 16px',borderBottom:`1px solid ${BRAND.border}`,background:BRAND.bgHeader,zIndex:100,flexShrink:0,flexWrap:'wrap'}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginRight:6}}>
          <div style={{width:28,height:28,background:`linear-gradient(135deg,${BRAND.blue},${BRAND.blueMid})`,borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:14,color:'#fff'}}>P</div>
          <div>
            <div style={{fontWeight:700,fontSize:13,lineHeight:1.2}}>Atribuição de Peças</div>
            <div style={{fontSize:9,color:BRAND.textMuted}}>Protendit Construções</div>
          </div>
        </div>
        <select style={S.btn} value={filterGrp} onChange={e=>setFilterGrp(e.target.value)}>
          <option value="todos">Todos os grupos</option>
          <option value="projinternos">Proj. Internos</option>
          <option value="verificadores">Verificadores</option>
          <option value="projexternos">Proj. Externos</option>
        </select>
        <button style={S.btnA(filterImp)} onClick={()=>setFilterImp(p=>!p)}>⭐ Importantes</button>
        <div style={{marginLeft:'auto',display:'flex',gap:6}}>
          <button style={S.btn} onClick={()=>setModal({type:'add-pessoa'})}>+ Pessoa</button>
          <button style={S.btnG} onClick={()=>setModal({type:'add-contrato'})}>+ Contrato</button>
          <button style={S.btn} onClick={()=>setShowDash(true)}>📊 Dashboard</button>
          <button style={S.btn} onClick={exportPDF}>⬇ PDF</button>
        </div>
      </div>

      {/* BOARD */}
      <div ref={boardRef} style={{flex:1,display:'grid',gridTemplateColumns:'1fr 1fr 1fr 2fr',gap:0,overflow:'hidden',position:'relative'}}>

        {/* SVG setas */}
        <svg style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:50,overflow:'visible'}}>
          <defs>
            <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M2 1L8 5L2 9" fill="none" stroke={BRAND.teal} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </marker>
          </defs>
          {arrows.map((a,i)=>{
            const mx=(a.x1+a.x2)/2
            return <path key={i} d={`M${a.x1} ${a.y1} C${mx} ${a.y1} ${mx} ${a.y2} ${a.x2} ${a.y2}`}
              fill="none" stroke={BRAND.teal} strokeWidth="1.5" opacity=".7" markerEnd="url(#arr)"/>
          })}
        </svg>

        {/* COL 1 — Proj. Internos */}
        <ColPessoas
          titulo="Proj. Internos" cor={BRAND.blueMid} bg="#eef4ff"
          pessoas={pessoasF.filter(p=>p.grupo==='projinternos')}
          selPessoa={selPessoa} vinculos={vinculos}
          onClickPessoa={handleClickPessoa}
          onEdit={p=>setModal({type:'edit-pessoa',data:p})}
          onDel={delPessoa}
          pessoaLinks={pessoaLinks}
          onRemoveVinculo={removeVinculo}
          S={S} BRAND={BRAND}
        />

        {/* COL 2 — Verificadores */}
        <ColPessoas
          titulo="Verificadores" cor={BRAND.teal} bg="#e6faf8"
          pessoas={pessoasF.filter(p=>p.grupo==='verificadores')}
          selPessoa={selPessoa} vinculos={vinculos}
          onClickPessoa={handleClickPessoa}
          onEdit={p=>setModal({type:'edit-pessoa',data:p})}
          onDel={delPessoa}
          pessoaLinks={pessoaLinks}
          onRemoveVinculo={removeVinculo}
          S={S} BRAND={BRAND}
        />

        {/* COL 3 — Proj. Externos */}
        <ColPessoas
          titulo="Proj. Externos" cor={BRAND.green} bg="#edfaee"
          pessoas={pessoasF.filter(p=>p.grupo==='projexternos')}
          selPessoa={selPessoa} vinculos={vinculos}
          onClickPessoa={handleClickPessoa}
          onEdit={p=>setModal({type:'edit-pessoa',data:p})}
          onDel={delPessoa}
          pessoaLinks={pessoaLinks}
          onRemoveVinculo={removeVinculo}
          S={S} BRAND={BRAND}
        />

        {/* COL 4 — Contratos */}
        <div style={{background:'#f5fbf8',borderLeft:`2px solid ${BRAND.border}`,overflowY:'auto',padding:'8px 10px',display:'flex',flexDirection:'column',gap:6}}>
          <div style={{fontSize:10,fontWeight:700,color:BRAND.teal,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4,padding:'0 2px'}}>Contratos / Etapas</div>
          {contratosF.map(ct=>{
            const isOpen = openCts.includes(ct.id)
            const temV = ct.pecas.some(pc=>vinculos.some(v=>v.peca_id===pc.id))
            const isVinculadoSel = selPessoa && ct.pecas.some(pc=>vinculos.some(v=>v.peca_id===pc.id&&v.pessoa_id===selPessoa))
            return (
              <div key={ct.id} style={{background:'#fff',border:`1px solid ${isVinculadoSel?BRAND.teal:ct.importante?BRAND.amber:BRAND.border}`,borderRadius:10,overflow:'hidden',boxShadow:isVinculadoSel?`0 0 0 2px ${BRAND.teal}33`:'0 1px 3px rgba(0,0,0,.06)',transition:'border-color .2s'}}>
                {/* Header */}
                <div style={{display:'flex',alignItems:'center',gap:6,padding:'8px 10px',cursor:'pointer',background:temV?`${BRAND.teal}08`:isOpen?'#fafafa':'#fff',borderBottom:isOpen?`1px solid ${BRAND.border}`:'none'}}
                  onClick={()=>handleClickCt(ct.id)}>
                  <span style={{fontSize:11,color:BRAND.textDim,transition:'transform .2s',display:'inline-block',transform:isOpen?'rotate(90deg)':'rotate(0deg)'}}>▶</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,color:BRAND.blueMid,fontSize:11,letterSpacing:'.04em'}}>
                      {ct.num.toUpperCase().startsWith('CT')?ct.num.toUpperCase():'CT '+ct.num.toUpperCase()}
                    </div>
                    <div style={{fontWeight:700,color:BRAND.text,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ct.etapa.toUpperCase()}</div>
                  </div>
                  {temV&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:99,background:`${BRAND.teal}20`,color:BRAND.teal,fontWeight:600,flexShrink:0}}>{ct.pecas.filter(pc=>vinculos.some(v=>v.peca_id===pc.id)).length}</span>}
                  <span style={{color:ct.importante?BRAND.amber:BRAND.textDim,fontSize:14,flexShrink:0}} onClick={e=>toggleImportante(ct.id,e)}>{ct.importante?'★':'☆'}</span>
                  <span style={{color:BRAND.textMuted,fontSize:11,flexShrink:0}} onClick={e=>{e.stopPropagation();setModal({type:'edit-contrato',data:ct})}}>✎</span>
                  <span style={{color:BRAND.textMuted,fontSize:11,flexShrink:0}} onClick={e=>{e.stopPropagation();setModal({type:'edit-pecas',data:ct})}}>+</span>
                  <span style={{color:BRAND.textMuted,fontSize:15,flexShrink:0}} onClick={e=>{e.stopPropagation();delContrato(ct.id)}}>×</span>
                </div>
                {/* Peças */}
                {isOpen && ct.pecas.map(pc=>{
                  const linked = vinculos.some(v=>v.peca_id===pc.id)
                  const linkedSel = selPessoa&&vinculos.some(v=>v.peca_id===pc.id&&v.pessoa_id===selPessoa)
                  return (
                    <div key={pc.id} id={'pec-'+pc.id}
                      style={{padding:'6px 10px 6px 26px',borderBottom:`1px solid ${BRAND.border}`,cursor:selPessoa?'pointer':'default',background:linkedSel?`${BRAND.teal}12`:linked?`${BRAND.teal}05`:'transparent',color:linkedSel?BRAND.teal:linked?BRAND.teal:BRAND.textMuted,display:'flex',alignItems:'center',gap:7,fontSize:12,transition:'background .1s'}}
                      onClick={()=>toggleLink(pc.id)}>
                      <div style={{width:6,height:6,borderRadius:'50%',background:linkedSel?BRAND.teal:linked?`${BRAND.teal}88`:BRAND.border,flexShrink:0}}/>
                      {pc.nome}
                      {linkedSel&&<span style={{marginLeft:'auto',fontSize:10,color:BRAND.teal,fontWeight:600}}>✓</span>}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

      {/* DASHBOARD */}
      {showDash&&(
        <div style={S.modal} onClick={()=>setShowDash(false)}>
          <div style={{...S.mbox,width:500}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:14}}>
              <div style={{fontWeight:700,fontSize:15}}>Dashboard</div>
              <span style={{cursor:'pointer',fontSize:18,color:BRAND.textMuted}} onClick={()=>setShowDash(false)}>×</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:14}}>
              {[{l:'Pessoas',v:dash.totalP,c:BRAND.blueMid},{l:'Contratos',v:dash.totalC,c:BRAND.teal},{l:'Vínculos',v:dash.totalV,c:BRAND.green}].map((x,i)=>(
                <div key={i} style={{background:BRAND.bg,border:`1px solid ${BRAND.border}`,borderRadius:10,padding:12,textAlign:'center'}}>
                  <div style={{fontSize:24,fontWeight:700,color:x.c}}>{x.v}</div>
                  <div style={{fontSize:11,color:BRAND.textMuted,marginTop:2}}>{x.l}</div>
                </div>
              ))}
            </div>
            <div style={{fontWeight:600,fontSize:11,marginBottom:7,color:BRAND.textMuted}}>Por grupo</div>
            {dash.porGrupo.map((g,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,marginBottom:6,padding:'7px 12px',background:BRAND.bg,border:`1px solid ${BRAND.border}`,borderRadius:8}}>
                <div style={{width:8,height:8,borderRadius:'50%',background:g.cor}}/>
                <span style={{flex:1,fontSize:12,fontWeight:500}}>{g.label}</span>
                <span style={{fontSize:12,color:BRAND.textMuted}}>{g.count} pessoas</span>
                <span style={{fontSize:12,fontWeight:600,color:g.cor}}>{g.vc} vínculos</span>
              </div>
            ))}
            <div style={{fontWeight:600,fontSize:11,margin:'12px 0 7px',color:BRAND.textMuted}}>Mais atribuídos</div>
            {dash.top.map((p,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:8,marginBottom:5,padding:'5px 12px',background:BRAND.bg,border:`1px solid ${BRAND.border}`,borderRadius:8}}>
                <span style={{fontSize:11,color:BRAND.textMuted,width:14,textAlign:'right'}}>{i+1}.</span>
                <span style={{flex:1,fontSize:12,fontWeight:500}}>{p.nome}</span>
                <span style={{fontSize:12,fontWeight:600,color:BRAND.blueMid}}>{p.n} peças</span>
              </div>
            ))}
            {dash.semVinculo>0&&<div style={{marginTop:10,padding:'7px 12px',background:'#fff8e1',border:'1px solid #ffe082',borderRadius:8,fontSize:11,color:'#795548'}}>{dash.semVinculo} pessoa(s) sem vínculo</div>}
          </div>
        </div>
      )}

      {/* MODAIS */}
      {modal&&(
        <div style={S.modal} onClick={()=>setModal(null)}>
          <div style={S.mbox} onClick={e=>e.stopPropagation()}>
            {modal.type==='add-pessoa'&&<MPessoa title="Nova pessoa" onSave={savePessoa} onClose={()=>setModal(null)} S={S}/>}
            {modal.type==='edit-pessoa'&&<MPessoa title="Editar pessoa" data={modal.data} onSave={(n,g)=>editPessoa(modal.data.id,n,g)} onClose={()=>setModal(null)} S={S}/>}
            {modal.type==='add-contrato'&&<MContrato title="Novo contrato" onSave={saveContrato} onClose={()=>setModal(null)} S={S} brand={BRAND}/>}
            {modal.type==='edit-contrato'&&<MContrato title="Editar contrato" data={modal.data} onSave={(n,e)=>editContrato(modal.data.id,n,e)} onClose={()=>setModal(null)} S={S} brand={BRAND}/>}
            {modal.type==='edit-pecas'&&<MPecas ct={modal.data} onAdd={addPecaContrato} onDel={delPeca} onClose={()=>setModal(null)} S={S} brand={BRAND}/>}
          </div>
        </div>
      )}
    </div>
  )
}

function ColPessoas({titulo,cor,bg,pessoas,selPessoa,vinculos,onClickPessoa,onEdit,onDel,pessoaLinks,onRemoveVinculo,S,BRAND}){
  return (
    <div style={{background:bg,borderRight:`1px solid ${BRAND.border}`,overflowY:'auto',padding:'8px 8px',display:'flex',flexDirection:'column',gap:5}}>
      <div style={{fontSize:10,fontWeight:700,color:cor,textTransform:'uppercase',letterSpacing:'.06em',marginBottom:4,padding:'0 2px'}}>{titulo}</div>
      {pessoas.map(p=>{
        const isSel = selPessoa===p.id
        const links = pessoaLinks(p.id)
        const grp = GRUPOS[p.grupo]||GRUPOS.projinternos
        return (
          <div key={p.id} id={'p-'+p.id}
            style={{background:'#fff',border:`1px solid ${isSel?cor:BRAND.border}`,borderRadius:9,padding:'8px 10px',cursor:'pointer',boxShadow:isSel?`0 0 0 2px ${cor}33`:'0 1px 3px rgba(0,0,0,.05)',transition:'all .15s'}}
            onClick={()=>onClickPessoa(p.id)}>
            <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:isSel&&links.length?4:0}}>
              <span style={{fontWeight:600,color:BRAND.text,flex:1,fontSize:13}}>{p.nome}</span>
              {!isSel&&links.length>0&&<span style={{fontSize:10,padding:'1px 5px',borderRadius:99,background:grp.bg,color:grp.cor,border:`1px solid ${grp.bd}`,fontWeight:600}}>{links.length}</span>}
              <span style={{color:BRAND.textMuted,fontSize:11,cursor:'pointer'}} onClick={e=>{e.stopPropagation();onEdit(p)}}>✎</span>
              <span style={{color:BRAND.textMuted,fontSize:14,cursor:'pointer'}} onClick={e=>{e.stopPropagation();onDel(p.id)}}>×</span>
            </div>
            {isSel&&links.length>0&&(
              <div style={{display:'flex',flexDirection:'column',gap:2}}>
                {links.map((l,i)=>(
                  <span key={i} style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:grp.bg,color:grp.cor,border:`1px solid ${grp.bd}`,display:'flex',alignItems:'center',gap:4}}>
                    <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{l.label}</span>
                    <span style={{cursor:'pointer',fontWeight:700,opacity:.6,flexShrink:0}} onClick={e=>onRemoveVinculo(l.vid,e)}>×</span>
                  </span>
                ))}
              </div>
            )}
            {isSel&&links.length===0&&<div style={{fontSize:10,color:BRAND.textDim}}>sem vínculos</div>}
          </div>
        )
      })}
    </div>
  )
}

function MPessoa({title,data,onSave,onClose,S}){
  const [nome,setNome]=useState(data?.nome||'')
  const [grupo,setGrupo]=useState(data?.grupo||'projinternos')
  return <>
    <div style={{fontWeight:700,marginBottom:14,fontSize:14}}>{title}</div>
    <input style={S.inp} value={nome} onChange={e=>setNome(e.target.value)} placeholder="Nome" autoFocus/>
    <select style={S.inp} value={grupo} onChange={e=>setGrupo(e.target.value)}>
      <option value="projinternos">Proj. Internos</option>
      <option value="verificadores">Verificadores</option>
      <option value="projexternos">Proj. Externos</option>
    </select>
    <div style={{display:'flex',gap:8}}>
      <button style={S.btn} onClick={onClose}>Cancelar</button>
      <button style={S.btnG} onClick={()=>onSave(nome,grupo)}>Salvar</button>
    </div>
  </>
}

function MContrato({title,data,onSave,onClose,S,brand}){
  const [num,setNum]=useState(data?.num||'')
  const [etapa,setEtapa]=useState(data?.etapa||'')
  const [pecas,setPecas]=useState('')
  return <>
    <div style={{fontWeight:700,marginBottom:14,fontSize:14}}>{title}</div>
    <input style={S.inp} value={num} onChange={e=>setNum(e.target.value)} placeholder="Número (ex: 2455)" autoFocus/>
    <input style={S.inp} value={etapa} onChange={e=>setEtapa(e.target.value)} placeholder="Etapa (ex: Unicev)"/>
    {!data&&<>
      <input style={S.inp} value={pecas} onChange={e=>setPecas(e.target.value)} placeholder="Pilar, Viga, Terça, Patrão"/>
      <div style={{fontSize:10,color:brand?.textMuted,marginBottom:8,marginTop:-4}}>Tipos de peça separados por vírgula</div>
    </>}
    <div style={{display:'flex',gap:8}}>
      <button style={S.btn} onClick={onClose}>Cancelar</button>
      <button style={S.btnB} onClick={()=>onSave(num,etapa,pecas)}>Salvar</button>
    </div>
  </>
}

function MPecas({ct,onAdd,onDel,onClose,S,brand}){
  const [nova,setNova]=useState('')
  return <>
    <div style={{fontWeight:700,marginBottom:4,fontSize:14}}>Peças — {ct.num} {ct.etapa}</div>
    <div style={{fontSize:11,color:brand?.textMuted,marginBottom:12}}>Clique × para remover</div>
    <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:12,maxHeight:200,overflowY:'auto'}}>
      {ct.pecas.map(pc=>(
        <div key={pc.id} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 8px',background:'#f8f9fa',borderRadius:6,border:'1px solid #e2e8f0'}}>
          <span style={{flex:1,fontSize:12}}>{pc.nome}</span>
          <span style={{cursor:'pointer',color:'#999',fontWeight:700,fontSize:14}} onClick={()=>onDel(ct.id,pc.id)}>×</span>
        </div>
      ))}
      {!ct.pecas.length&&<div style={{fontSize:11,color:brand?.textMuted}}>Nenhuma peça</div>}
    </div>
    <div style={{display:'flex',gap:6,marginBottom:12}}>
      <input style={{...S.inp,marginBottom:0,flex:1}} value={nova} onChange={e=>setNova(e.target.value)} placeholder="Nova peça..."
        onKeyDown={e=>{if(e.key==='Enter'&&nova.trim()){onAdd(ct.id,nova);setNova('')}}}/>
      <button style={S.btnG} onClick={()=>{if(nova.trim()){onAdd(ct.id,nova);setNova('')}}}>+ Add</button>
    </div>
    <button style={S.btn} onClick={onClose}>Fechar</button>
  </>
}