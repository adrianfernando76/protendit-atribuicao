import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

const BRAND = {
  bg:'#f0f2f5', bgCard:'#ffffff', bgHeader:'#ffffff',
  bgPessoas:'#eef4ff', bgContratos:'#f0faf5',
  border:'#e2e8f0', blue:'#1A3A5C', blueMid:'#2196F3',
  teal:'#26A69A', green:'#4CAF50',
  text:'#1a202c', textMuted:'#718096', textDim:'#cbd5e0',
}
const GRUPOS = {
  projinternos:  {label:'Proj. Internos', cor:'#2196F3', bg:'#dbeafe', bd:'#93c5fd'},
  verificadores: {label:'Verificadores',  cor:'#26A69A', bg:'#ccfbf1', bd:'#6ee7b7'},
  projexternos:  {label:'Proj. Externos', cor:'#4CAF50', bg:'#dcfce7', bd:'#86efac'},
}
const SNAP = 8

export default function App() {
  const [pessoas, setPessoas]   = useState([])
  const [contratos, setContratos] = useState([])
  const [vinculos, setVinculos] = useState([])
  const [sel, setSel]           = useState([])
  const [modal, setModal]       = useState(null)
  const [arrows, setArrows]     = useState([])
  const [guides, setGuides]     = useState([])
  const [zoom, setZoom]         = useState(1)
  const [pan, setPan]           = useState({x:0, y:0})
  const [showDash, setShowDash] = useState(false)
  const [filterGrp, setFilterGrp] = useState('todos')
  const [filterCt, setFilterCt]   = useState('todos')
  const [mode, setMode]         = useState('move') // 'move' | 'draw'
  const [strokes, setStrokes]   = useState([])
  const [drawing, setDrawing]   = useState(false)
  const [currentStroke, setCurrentStroke] = useState([])
  const [penColor, setPenColor] = useState('#e53e3e')
  const [penSize, setPenSize]   = useState(3)
  const canvasRef  = useRef(null)
  const svgDrawRef = useRef(null)
  const dragRef    = useRef(null)
  const arrowTimer = useRef(null)
  const zoomRef    = useRef(zoom)
  const panRef     = useRef(pan)
  useEffect(() => { zoomRef.current = zoom }, [zoom])
  useEffect(() => { panRef.current = pan }, [pan])

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

  function scheduleArrows() {
    if (arrowTimer.current) clearTimeout(arrowTimer.current)
    arrowTimer.current = setTimeout(calcArrows, 60)
  }
  useEffect(() => { scheduleArrows() }, [vinculos, pessoas, contratos, sel, zoom, pan])
  useEffect(() => { window.addEventListener('resize', calcArrows); return () => window.removeEventListener('resize', calcArrows) }, [])

  function worldToScreen(wx, wy) {
    return { x: wx * zoomRef.current + panRef.current.x, y: wy * zoomRef.current + panRef.current.y }
  }

  function calcArrows() {
    if (!canvasRef.current || sel.length === 0) { setArrows([]); return }
    const rect = canvasRef.current.getBoundingClientRect()
    const boxes = []
    canvasRef.current.querySelectorAll('.draggable').forEach(el => {
      const r = el.getBoundingClientRect()
      boxes.push({ id: el.id, x: r.left-rect.left, y: r.top-rect.top, w: r.width, h: r.height })
    })
    const result = []
    vinculos.forEach(v => {
      const pEl = document.getElementById('card-'+v.pessoa_id)
      if (!pEl) return
      if (!sel.includes(v.pessoa_id)) return
      const pcEl = document.getElementById('pec-'+v.peca_id)
      if (!pEl||!pcEl) return
      const pR = pEl.getBoundingClientRect()
      const pcR = pcEl.getBoundingClientRect()
      const x1 = pR.right-rect.left, y1 = pR.top+pR.height/2-rect.top
      const x2 = pcR.left-rect.left, y2 = pcR.top+pcR.height/2-rect.top
      const midX = (x1+x2)/2, midY = (y1+y2)/2
      let collision = null
      boxes.forEach(b => {
        if (b.id==='card-'+v.pessoa_id) return
        if (midX>b.x+8&&midX<b.x+b.w-8&&midY>b.y+8&&midY<b.y+b.h-8) collision=b
      })
      result.push({x1,y1,x2,y2,midX,midY,safeY:collision?collision.y-18:null})
    })
    setArrows(result)
  }

  function pessoaLinks(pid) {
    return vinculos.filter(v=>v.pessoa_id===pid).map(v=>{
      for (const ct of contratos) {
        const pc = ct.pecas.find(p=>p.id===v.peca_id)
        if (pc) return {label:`${ct.num} ${ct.etapa} / ${pc.nome}`, vinculoId:v.id}
      }
      return null
    }).filter(Boolean)
  }

  async function removeVinculo(vinculoId, e) {
    e.stopPropagation()
    setVinculos(prev=>prev.filter(v=>v.id!==vinculoId))
    await supabase.from('vinculos').delete().eq('id',vinculoId)
  }

  async function toggleLink(pecaId) {
    if (!sel.length) return
    const pessoaId = sel[sel.length-1]
    if (!pessoas.find(p=>p.id===pessoaId)) return
    const exists = vinculos.find(v=>v.pessoa_id===pessoaId&&v.peca_id===pecaId)
    if (exists) {
      setVinculos(prev=>prev.filter(v=>v.id!==exists.id))
      await supabase.from('vinculos').delete().eq('id',exists.id)
    } else {
      const novo = {pessoa_id:pessoaId, peca_id:pecaId, id:'tmp-'+Date.now()}
      setVinculos(prev=>[...prev,novo])
      await supabase.from('vinculos').insert({pessoa_id:pessoaId, peca_id:pecaId})
    }
  }

  function toggleSel(id, e) {
    e.stopPropagation()
    if (e.ctrlKey||e.metaKey) setSel(prev=>prev.includes(id)?prev.filter(s=>s!==id):[...prev,id])
    else setSel(prev=>prev.length===1&&prev[0]===id?[]:[id])
  }

  async function savePessoa(nome, grupo) {
    if (!nome.trim()) return
    const lista = pessoas.filter(p=>p.grupo===grupo)
    const lastY = lista.length ? Math.max(...lista.map(p=>p.pos_y||0))+110 : 20
    setPessoas(prev=>[...prev,{id:'tmp-'+Date.now(),nome:nome.trim(),grupo,pos_x:20,pos_y:lastY,criado_em:new Date().toISOString()}])
    await supabase.from('pessoas').insert({nome:nome.trim(),grupo,pos_x:20,pos_y:lastY})
    setModal(null)
  }

  async function saveContrato(num, etapa, pecasStr) {
    if (!num.trim()||!etapa.trim()) return
    const px = 700+contratos.length*185
    const {data:ct} = await supabase.from('contratos').insert({num:num.trim(),etapa:etapa.trim(),pos_x:px,pos_y:20}).select().single()
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

  async function delPessoa(id) {
    setPessoas(prev=>prev.filter(p=>p.id!==id))
    setVinculos(prev=>prev.filter(v=>v.pessoa_id!==id))
    setSel(prev=>prev.filter(s=>s!==id))
    await supabase.from('pessoas').delete().eq('id',id)
  }

  async function delContrato(id) {
    const pcIds = contratos.find(c=>c.id===id)?.pecas.map(p=>p.id)||[]
    setContratos(prev=>prev.filter(c=>c.id!==id))
    setVinculos(prev=>prev.filter(v=>!pcIds.includes(v.peca_id)))
    await supabase.from('contratos').delete().eq('id',id)
  }

  function cardHeightPessoa(p) {
    return 68 + (pessoaLinks(p.id).length > 0 ? pessoaLinks(p.id).length * 22 : 18)
  }
  function cardHeightCt(ct) { return 52 + ct.pecas.length * 30 }

  async function autoOrganize(onlySelected=false) {
    const GAP_Y=14, SX=20, SY=20
    const grpOrder=['projinternos','verificadores','projexternos']
    let y=SY
    const updates=[]
    grpOrder.forEach(grp=>{
      const lista=pessoas.filter(p=>p.grupo===grp&&(!onlySelected||sel.includes(p.id)))
      lista.forEach(p=>{
        updates.push({table:'pessoas',id:p.id,pos_x:SX,pos_y:y})
        y+=cardHeightPessoa(p)+GAP_Y
      })
      if(lista.length) y+=20
    })
    const ctList=contratos.filter(ct=>!onlySelected||sel.includes(ct.id))
    let ctY=SY
    ctList.forEach((ct,i)=>{
      const col=Math.floor(i/6), row=i%6
      if(row===0) ctY=SY
      updates.push({table:'contratos',id:ct.id,pos_x:700+col*185,pos_y:ctY})
      ctY+=cardHeightCt(ct)+GAP_Y
    })
    setPessoas(prev=>prev.map(p=>{const u=updates.find(u=>u.table==='pessoas'&&u.id===p.id);return u?{...p,pos_x:u.pos_x,pos_y:u.pos_y}:p}))
    setContratos(prev=>prev.map(c=>{const u=updates.find(u=>u.table==='contratos'&&u.id===c.id);return u?{...c,pos_x:u.pos_x,pos_y:u.pos_y}:c}))
    setTimeout(()=>{updates.forEach(u=>{const el=document.getElementById('card-'+u.id);if(el){el.style.left=u.pos_x+'px';el.style.top=u.pos_y+'px'}});scheduleArrows()},30)
    for(const u of updates) await supabase.from(u.table).update({pos_x:u.pos_x,pos_y:u.pos_y}).eq('id',u.id)
  }

  // ZOOM
  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const onWheel = e => {
      if (!e.ctrlKey && e.touches?.length !== 2) return
      e.preventDefault()
      const delta = e.deltaY || 0
      setZoom(z => Math.min(2, Math.max(0.3, z - delta * 0.001)))
    }
    el.addEventListener('wheel', onWheel, {passive:false})
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // DRAG mouse + touch
  function startDrag(e, id) {
    if (mode === 'draw') return
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    if (!e.touches && e.button !== 0) return
    const dragIds = sel.includes(id)&&sel.length>1 ? sel : [id]
    const offsets = dragIds.map(did=>{
      const el=document.getElementById('card-'+did)
      return {id:did,el,startL:parseFloat(el?.style.left)||0,startT:parseFloat(el?.style.top)||0}
    })
    dragRef.current={ids:dragIds,offsets,startX:clientX,startY:clientY,moved:false}
    e.preventDefault?.()
    e.stopPropagation?.()
  }

  useEffect(() => {
    const move = e => {
      if (!dragRef.current) return
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const clientY = e.touches ? e.touches[0].clientY : e.clientY
      const {offsets,startX,startY} = dragRef.current
      const dx=(clientX-startX)/zoomRef.current, dy=(clientY-startY)/zoomRef.current
      const newGuides=[], allCards=[...pessoas,...contratos]
      offsets.forEach(o=>{
        let nx=Math.max(0,o.startL+dx), ny=Math.max(0,o.startT+dy)
        if(offsets.length===1){
          allCards.forEach(item=>{
            if(item.id===o.id) return
            const ox=item.pos_x||0,oy=item.pos_y||0
            if(Math.abs(ny-oy)<SNAP){ny=oy;newGuides.push({type:'h',y:oy})}
            if(Math.abs(nx-ox)<SNAP){nx=ox;newGuides.push({type:'v',x:ox})}
          })
        }
        if(o.el){o.el.style.left=nx+'px';o.el.style.top=ny+'px'}
        o.nx=nx;o.ny=ny
      })
      dragRef.current.moved=true
      setGuides(newGuides);scheduleArrows()
    }
    const up = async () => {
      if(!dragRef.current) return
      const {offsets,moved}=dragRef.current
      dragRef.current=null;setGuides([])
      if(!moved) return
      for(const o of offsets){
        if(o.nx===undefined) continue
        const isPessoa=pessoas.some(p=>p.id===o.id)
        const table=isPessoa?'pessoas':'contratos'
        if(isPessoa) setPessoas(prev=>prev.map(p=>p.id===o.id?{...p,pos_x:o.nx,pos_y:o.ny}:p))
        else setContratos(prev=>prev.map(c=>c.id===o.id?{...c,pos_x:o.nx,pos_y:o.ny}:c))
        await supabase.from(table).update({pos_x:o.nx,pos_y:o.ny}).eq('id',o.id)
      }
    }
    window.addEventListener('mousemove',move)
    window.addEventListener('mouseup',up)
    window.addEventListener('touchmove',move,{passive:false})
    window.addEventListener('touchend',up)
    return()=>{
      window.removeEventListener('mousemove',move)
      window.removeEventListener('mouseup',up)
      window.removeEventListener('touchmove',move)
      window.removeEventListener('touchend',up)
    }
  }, [pessoas,contratos,sel])

  // DRAW
  function getDrawPos(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom
    }
  }

  function onDrawStart(e) {
    if (mode !== 'draw') return
    e.preventDefault()
    setDrawing(true)
    const pos = getDrawPos(e)
    setCurrentStroke([pos])
  }

  function onDrawMove(e) {
    if (!drawing || mode !== 'draw') return
    e.preventDefault()
    const pos = getDrawPos(e)
    setCurrentStroke(prev => [...prev, pos])
  }

  function onDrawEnd(e) {
    if (!drawing || mode !== 'draw') return
    setDrawing(false)
    if (currentStroke.length > 1) setStrokes(prev => [...prev, {points:currentStroke, color:penColor, size:penSize}])
    setCurrentStroke([])
  }

  function pointsToPath(pts) {
    if (!pts.length) return ''
    return pts.map((p,i)=>i===0?`M${p.x},${p.y}`:`L${p.x},${p.y}`).join(' ')
  }

  // EXPORT PDF
  async function exportPDF() {
    const jsPDF = (await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js')).jsPDF
    const doc = new jsPDF({orientation:'landscape',unit:'mm',format:'a4'})
    doc.setFont('helvetica','bold')
    doc.setFontSize(16)
    doc.text('Atribuição de Peças — Protendit Construções', 14, 15)
    doc.setFontSize(10)
    doc.setFont('helvetica','normal')
    doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')}`, 14, 22)
    let y = 32
    const grpOrder = ['projinternos','verificadores','projexternos']
    grpOrder.forEach(grp => {
      const lista = pessoas.filter(p=>p.grupo===grp)
      if (!lista.length) return
      doc.setFont('helvetica','bold')
      doc.setFontSize(11)
      doc.text(GRUPOS[grp].label, 14, y); y+=6
      lista.forEach(p => {
        const links = pessoaLinks(p.id)
        doc.setFont('helvetica','bold')
        doc.setFontSize(10)
        doc.text(`• ${p.nome}`, 18, y); y+=5
        if (links.length) {
          doc.setFont('helvetica','normal')
          doc.setFontSize(9)
          links.forEach(l => { doc.text(`  — ${l.label}`, 22, y); y+=4 })
        } else {
          doc.setFont('helvetica','italic')
          doc.setFontSize(9)
          doc.text('  sem vínculos', 22, y); y+=4
        }
        if (y > 185) { doc.addPage(); y = 20 }
      })
      y += 4
    })
    doc.save('atribuicao-protendit.pdf')
  }

  // DASHBOARD DATA
  const dashData = {
    totalPessoas: pessoas.length,
    totalContratos: contratos.length,
    totalVinculos: vinculos.length,
    porGrupo: Object.keys(GRUPOS).map(g => ({
      label: GRUPOS[g].label, cor: GRUPOS[g].cor,
      count: pessoas.filter(p=>p.grupo===g).length,
      vinculos: vinculos.filter(v=>pessoas.find(p=>p.id===v.pessoa_id&&p.grupo===g)).length
    })),
    semVinculo: pessoas.filter(p=>!vinculos.some(v=>v.pessoa_id===p.id)).length,
    topPessoas: pessoas.map(p=>({nome:p.nome,count:vinculos.filter(v=>v.pessoa_id===p.id).length})).sort((a,b)=>b.count-a.count).slice(0,5)
  }

  const isSel = id => sel.includes(id)

  const pessoasFiltradas = pessoas.filter(p => filterGrp==='todos'||p.grupo===filterGrp)
  const contratosFiltrados = contratos.filter(ct => filterCt==='todos'||ct.id===filterCt)

  const s = {
    app:{background:BRAND.bg,width:'100vw',height:'100vh',fontFamily:"'Segoe UI',sans-serif",fontSize:13,color:BRAND.text,display:'flex',flexDirection:'column',overflow:'hidden',position:'fixed',top:0,left:0},
    topbar:{display:'flex',alignItems:'center',gap:8,padding:'8px 16px',borderBottom:`1px solid ${BRAND.border}`,background:BRAND.bgHeader,zIndex:100,flexShrink:0,flexWrap:'wrap'},
    canvasWrap:{flex:1,overflow:'hidden',position:'relative',cursor:mode==='draw'?'crosshair':'default'},
    canvas:{position:'absolute',width:4000,height:3000,transformOrigin:'0 0',transform:`scale(${zoom}) translate(${pan.x/zoom}px,${pan.y/zoom}px)`},
    card:(id)=>({background:BRAND.bgCard,border:`1px solid ${isSel(id)?BRAND.blueMid:BRAND.border}`,boxShadow:isSel(id)?`0 0 0 2px ${BRAND.blueMid}33`:'0 1px 4px rgba(0,0,0,.08)',borderRadius:10,padding:'10px 12px',width:190}),
    ctCard:(id)=>({background:BRAND.bgCard,border:`1px solid ${isSel(id)?BRAND.blueMid:BRAND.border}`,boxShadow:isSel(id)?`0 0 0 2px ${BRAND.blueMid}33`:'0 1px 4px rgba(0,0,0,.08)',borderRadius:10,width:165,overflow:'hidden'}),
    btn:{fontSize:11,padding:'5px 10px',borderRadius:6,border:`1px solid ${BRAND.border}`,background:'transparent',color:BRAND.textMuted,cursor:'pointer'},
    btnBlue:{fontSize:11,padding:'5px 10px',borderRadius:6,border:`1px solid ${BRAND.blueMid}`,background:`${BRAND.blueMid}15`,color:BRAND.blueMid,cursor:'pointer'},
    btnGreen:{fontSize:11,padding:'5px 10px',borderRadius:6,border:`1px solid ${BRAND.green}`,background:`${BRAND.green}15`,color:BRAND.green,cursor:'pointer'},
    btnActive:(active)=>({fontSize:11,padding:'5px 10px',borderRadius:6,border:`1px solid ${active?BRAND.blueMid:BRAND.border}`,background:active?`${BRAND.blueMid}20`:'transparent',color:active?BRAND.blueMid:BRAND.textMuted,cursor:'pointer'}),
    handle:{cursor:'grab',color:BRAND.textDim,fontSize:14,padding:'0 4px',userSelect:'none',touchAction:'none'},
    peca:(linked)=>({padding:'6px 10px',borderBottom:`1px solid ${BRAND.border}`,cursor:'pointer',background:linked?'#f0fdf4':'transparent',color:linked?BRAND.teal:BRAND.textMuted,display:'flex',alignItems:'center',gap:7,fontSize:12}),
    dot:(linked)=>({width:6,height:6,borderRadius:'50%',background:linked?BRAND.teal:BRAND.border,flexShrink:0}),
    modal:{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'},
    modalBox:{background:'#fff',border:`1px solid ${BRAND.border}`,borderRadius:12,padding:24,width:360,boxShadow:'0 8px 32px rgba(0,0,0,.15)'},
    inp:{width:'100%',marginBottom:8,background:'#fff',border:`1px solid ${BRAND.border}`,color:BRAND.text,borderRadius:6,padding:'8px 10px',fontSize:12,outline:'none'},
  }

  return (
    <div style={s.app} onClick={()=>setSel([])}>

      {/* TOPBAR */}
      <div style={s.topbar} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginRight:8}}>
          <div style={{width:30,height:30,background:`linear-gradient(135deg,${BRAND.blue},${BRAND.blueMid})`,borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:15,color:'#fff',flexShrink:0}}>P</div>
          <div>
            <div style={{fontWeight:700,fontSize:13,color:BRAND.text,lineHeight:1.2}}>Atribuição de Peças</div>
            <div style={{fontSize:10,color:BRAND.textMuted}}>Protendit Construções</div>
          </div>
        </div>

        {/* Filtros */}
        <select style={{...s.btn,fontSize:11}} value={filterGrp} onChange={e=>setFilterGrp(e.target.value)}>
          <option value="todos">Todos os grupos</option>
          <option value="projinternos">Proj. Internos</option>
          <option value="verificadores">Verificadores</option>
          <option value="projexternos">Proj. Externos</option>
        </select>
        <select style={{...s.btn,fontSize:11}} value={filterCt} onChange={e=>setFilterCt(e.target.value)}>
          <option value="todos">Todos os contratos</option>
          {contratos.map(ct=><option key={ct.id} value={ct.id}>{ct.num} {ct.etapa}</option>)}
        </select>

        <div style={{display:'flex',gap:4,background:BRAND.bg,borderRadius:8,padding:3,border:`1px solid ${BRAND.border}`}}>
          <button style={s.btnActive(mode==='move')} onClick={()=>setMode('move')} title="Modo mover">✥ Mover</button>
          <button style={s.btnActive(mode==='draw')} onClick={()=>setMode('draw')} title="Modo caneta">✏ Caneta</button>
        </div>

        {mode==='draw' && <>
          <input type="color" value={penColor} onChange={e=>setPenColor(e.target.value)} style={{width:28,height:28,border:'none',borderRadius:6,cursor:'pointer',padding:0}} title="Cor da caneta"/>
          <input type="range" min={1} max={12} value={penSize} onChange={e=>setPenSize(+e.target.value)} style={{width:60}} title="Espessura"/>
          <button style={s.btn} onClick={()=>setStrokes([])}>🗑 Limpar</button>
        </>}

        <div style={{display:'flex',gap:4,marginLeft:'auto'}}>
          <button style={s.btn} onClick={()=>setZoom(z=>Math.min(2,z+0.1))}>＋</button>
          <button style={{...s.btn,minWidth:42,textAlign:'center'}} onClick={()=>setZoom(1)}>{Math.round(zoom*100)}%</button>
          <button style={s.btn} onClick={()=>setZoom(z=>Math.max(0.3,z-0.1))}>－</button>
        </div>

        {sel.length>0 && <button style={s.btnBlue} onClick={()=>autoOrganize(true)}>⊞ Org. selecionados</button>}
        <button style={s.btn} onClick={()=>autoOrganize(false)}>⊞ Organizar</button>
        <button style={s.btn} onClick={()=>setModal({type:'add-pessoa'})}>+ Pessoa</button>
        <button style={s.btnGreen} onClick={()=>setModal({type:'add-contrato'})}>+ Contrato</button>
        <button style={s.btn} onClick={()=>setShowDash(true)}>📊 Dashboard</button>
        <button style={s.btn} onClick={exportPDF}>⬇ PDF</button>
      </div>

      {/* CANVAS */}
      <div style={s.canvasWrap} ref={canvasRef}
        onMouseDown={mode==='draw'?onDrawStart:undefined}
        onMouseMove={mode==='draw'?onDrawMove:undefined}
        onMouseUp={mode==='draw'?onDrawEnd:undefined}
        onTouchStart={mode==='draw'?onDrawStart:undefined}
        onTouchMove={mode==='draw'?onDrawMove:undefined}
        onTouchEnd={mode==='draw'?onDrawEnd:undefined}>

        <div style={s.canvas}>
          {/* Fundos de área */}
          <div style={{position:'absolute',left:0,top:0,width:650,height:3000,background:BRAND.bgPessoas,borderRight:`2px dashed ${BRAND.border}`,zIndex:0,pointerEvents:'none'}}/>
          <div style={{position:'absolute',left:650,top:0,width:3350,height:3000,background:BRAND.bgContratos,zIndex:0,pointerEvents:'none'}}/>
          <div style={{position:'absolute',left:10,top:8,fontSize:10,fontWeight:600,color:BRAND.blueMid,textTransform:'uppercase',letterSpacing:'.06em',zIndex:2,pointerEvents:'none'}}>Equipe</div>
          <div style={{position:'absolute',left:660,top:8,fontSize:10,fontWeight:600,color:BRAND.teal,textTransform:'uppercase',letterSpacing:'.06em',zIndex:2,pointerEvents:'none'}}>Contratos / Etapas</div>

          {/* Guias */}
          {guides.map((g,i)=>
            g.type==='h'
              ?<div key={i} style={{position:'absolute',left:0,top:g.y,width:'100%',height:1,background:BRAND.blueMid,opacity:.4,zIndex:50,pointerEvents:'none'}}/>
              :<div key={i} style={{position:'absolute',top:0,left:g.x,width:1,height:'100%',background:BRAND.blueMid,opacity:.4,zIndex:50,pointerEvents:'none'}}/>
          )}

          {/* Setas — só quando selecionado */}
          <svg style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:5,overflow:'visible'}}>
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M2 1L8 5L2 9" fill="none" stroke={BRAND.teal} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </marker>
            </defs>
            {arrows.map((a,i)=>{
              const d=a.safeY!==null
                ?`M${a.x1} ${a.y1} C${a.midX} ${a.y1} ${a.midX} ${a.safeY} ${a.midX} ${a.safeY} C${a.midX} ${a.safeY} ${a.midX} ${a.y2} ${a.x2} ${a.y2}`
                :`M${a.x1} ${a.y1} C${a.midX} ${a.y1} ${a.midX} ${a.y2} ${a.x2} ${a.y2}`
              return <path key={i} d={d} fill="none" stroke={BRAND.teal} strokeWidth="1.5" opacity=".75" markerEnd="url(#arr)"/>
            })}
            {/* Rabiscos */}
            {strokes.map((s,i)=><path key={i} d={pointsToPath(s.points)} fill="none" stroke={s.color} strokeWidth={s.size} strokeLinecap="round" strokeLinejoin="round" opacity=".85"/>)}
            {drawing && currentStroke.length>1 && <path d={pointsToPath(currentStroke)} fill="none" stroke={penColor} strokeWidth={penSize} strokeLinecap="round" strokeLinejoin="round" opacity=".85"/>}
          </svg>

          {/* Cards pessoas */}
          {pessoasFiltradas.map(p=>{
            const grp=GRUPOS[p.grupo]||GRUPOS.projinternos
            const links=pessoaLinks(p.id)
            const expanded=isSel(p.id)
            return (
              <div key={p.id} id={'card-'+p.id} className="draggable"
                style={{position:'absolute',left:p.pos_x||20,top:p.pos_y||20,zIndex:10,touchAction:'none'}}
                onClick={e=>{e.stopPropagation();toggleSel(p.id,e)}}>
                <div style={s.card(p.id)}>
                  <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:4}}>
                    <span style={s.handle}
                      onMouseDown={e=>{e.stopPropagation();startDrag(e,p.id)}}
                      onTouchStart={e=>{e.stopPropagation();startDrag(e,p.id)}}>⠿</span>
                    <span style={{fontWeight:600,color:BRAND.text,flex:1,fontSize:13}}>{p.nome}</span>
                    {links.length>0 && <span style={{fontSize:10,padding:'1px 6px',borderRadius:99,background:grp.bg,color:grp.cor,border:`1px solid ${grp.bd}`,fontWeight:600}}>{links.length}</span>}
                    <span style={{color:BRAND.textMuted,fontSize:12,cursor:'pointer'}} onClick={e=>{e.stopPropagation();setModal({type:'edit-pessoa',data:p})}}>✎</span>
                    <span style={{color:BRAND.textMuted,fontSize:16,cursor:'pointer'}} onClick={e=>{e.stopPropagation();delPessoa(p.id)}}>×</span>
                  </div>
                  <div style={{fontSize:10,color:grp.cor,fontWeight:600,marginBottom:expanded&&links.length?5:0}}>{grp.label}</div>
                  {expanded && links.length>0 && (
                    <div style={{display:'flex',flexDirection:'column',gap:2,marginTop:4}}>
                      {links.map((t,i)=>(
                        <span key={i} style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:grp.bg,color:grp.cor,border:`1px solid ${grp.bd}`,display:'flex',alignItems:'center',justifyContent:'space-between',gap:4}}>
                          <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{t.label}</span>
                          <span style={{cursor:'pointer',fontWeight:700,fontSize:12,flexShrink:0,opacity:.6}} onClick={e=>removeVinculo(t.vinculoId,e)}>×</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* Cards contratos */}
          {contratosFiltrados.map(ct=>(
            <div key={ct.id} id={'card-'+ct.id} className="draggable"
              style={{position:'absolute',left:ct.pos_x||700,top:ct.pos_y||20,zIndex:10,touchAction:'none'}}
              onClick={e=>{e.stopPropagation();toggleSel(ct.id,e)}}>
              <div style={s.ctCard(ct.id)}>
                <div style={{padding:'8px 10px',background:BRAND.bgHeader,borderBottom:`1px solid ${BRAND.border}`,display:'flex',alignItems:'flex-start',gap:4}}>
                  <span style={s.handle}
                    onMouseDown={e=>{e.stopPropagation();startDrag(e,ct.id)}}
                    onTouchStart={e=>{e.stopPropagation();startDrag(e,ct.id)}}>⠿</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:700,color:BRAND.blueMid,fontSize:12,letterSpacing:'.04em'}}>
                      {ct.num.toUpperCase().startsWith('CT')?ct.num.toUpperCase():'CT '+ct.num.toUpperCase()}
                    </div>
                    <div style={{fontWeight:700,color:BRAND.text,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ct.etapa.toUpperCase()}</div>
                  </div>
                  <span style={{color:BRAND.textMuted,fontSize:12,cursor:'pointer',flexShrink:0}} onClick={e=>{e.stopPropagation();setModal({type:'edit-contrato',data:ct})}}>✎</span>
                  <span style={{color:BRAND.textMuted,fontSize:16,cursor:'pointer',flexShrink:0}} onClick={e=>{e.stopPropagation();delContrato(ct.id)}}>×</span>
                </div>
                {ct.pecas.map(pc=>{
                  const linked=vinculos.some(v=>v.peca_id===pc.id)
                  return (
                    <div key={pc.id} id={'pec-'+pc.id} style={s.peca(linked)}
                      onClick={e=>{e.stopPropagation();toggleLink(pc.id)}}>
                      <div style={s.dot(linked)}/>{pc.nome}
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* DASHBOARD */}
      {showDash && (
        <div style={s.modal} onClick={()=>setShowDash(false)}>
          <div style={{...s.modalBox,width:520,maxHeight:'80vh',overflowY:'auto'}} onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontWeight:700,fontSize:15}}>Dashboard</div>
              <span style={{cursor:'pointer',fontSize:18,color:BRAND.textMuted}} onClick={()=>setShowDash(false)}>×</span>
            </div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10,marginBottom:16}}>
              {[
                {label:'Pessoas',val:dashData.totalPessoas,cor:BRAND.blueMid},
                {label:'Contratos',val:dashData.totalContratos,cor:BRAND.teal},
                {label:'Vínculos',val:dashData.totalVinculos,cor:BRAND.green},
              ].map((item,i)=>(
                <div key={i} style={{background:BRAND.bgCard,border:`1px solid ${BRAND.border}`,borderRadius:10,padding:'12px 14px',textAlign:'center'}}>
                  <div style={{fontSize:24,fontWeight:700,color:item.cor}}>{item.val}</div>
                  <div style={{fontSize:11,color:BRAND.textMuted,marginTop:2}}>{item.label}</div>
                </div>
              ))}
            </div>
            <div style={{fontWeight:600,fontSize:12,marginBottom:8,color:BRAND.textMuted}}>Por grupo</div>
            {dashData.porGrupo.map((g,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,marginBottom:8,padding:'8px 12px',background:BRAND.bgCard,border:`1px solid ${BRAND.border}`,borderRadius:8}}>
                <div style={{width:10,height:10,borderRadius:'50%',background:g.cor,flexShrink:0}}/>
                <span style={{flex:1,fontSize:12,fontWeight:500}}>{g.label}</span>
                <span style={{fontSize:12,color:BRAND.textMuted}}>{g.count} pessoas</span>
                <span style={{fontSize:12,fontWeight:600,color:g.cor}}>{g.vinculos} vínculos</span>
              </div>
            ))}
            <div style={{fontWeight:600,fontSize:12,margin:'12px 0 8px',color:BRAND.textMuted}}>Mais atribuídos</div>
            {dashData.topPessoas.map((p,i)=>(
              <div key={i} style={{display:'flex',alignItems:'center',gap:10,marginBottom:6,padding:'6px 12px',background:BRAND.bgCard,border:`1px solid ${BRAND.border}`,borderRadius:8}}>
                <span style={{fontSize:11,color:BRAND.textMuted,width:16,textAlign:'right'}}>{i+1}.</span>
                <span style={{flex:1,fontSize:12,fontWeight:500}}>{p.nome}</span>
                <span style={{fontSize:12,fontWeight:600,color:BRAND.blueMid}}>{p.count} peças</span>
              </div>
            ))}
            <div style={{marginTop:12,padding:'8px 12px',background:'#fff8e1',border:'1px solid #ffe082',borderRadius:8,fontSize:11,color:'#795548'}}>
              {dashData.semVinculo} pessoa(s) sem nenhum vínculo atribuído
            </div>
          </div>
        </div>
      )}

      {/* MODAIS */}
      {modal && (
        <div style={s.modal} onClick={()=>setModal(null)}>
          <div style={s.modalBox} onClick={e=>e.stopPropagation()}>
            {modal.type==='add-pessoa' && <ModalPessoa title="Nova pessoa" onSave={savePessoa} onClose={()=>setModal(null)} s={s}/>}
            {modal.type==='edit-pessoa' && <ModalPessoa title="Editar pessoa" data={modal.data} onSave={(n,g)=>editPessoa(modal.data.id,n,g)} onClose={()=>setModal(null)} s={s}/>}
            {modal.type==='add-contrato' && <ModalContrato title="Novo contrato / etapa" onSave={saveContrato} onClose={()=>setModal(null)} s={s} brand={BRAND}/>}
            {modal.type==='edit-contrato' && <ModalContrato title="Editar contrato" data={modal.data} onSave={(n,e)=>editContrato(modal.data.id,n,e)} onClose={()=>setModal(null)} s={s} brand={BRAND}/>}
          </div>
        </div>
      )}
    </div>
  )
}

function ModalPessoa({title,data,onSave,onClose,s}){
  const [nome,setNome]=useState(data?.nome||'')
  const [grupo,setGrupo]=useState(data?.grupo||'projinternos')
  return <>
    <div style={{fontWeight:700,marginBottom:14,fontSize:14}}>{title}</div>
    <input style={s.inp} value={nome} onChange={e=>setNome(e.target.value)} placeholder="Nome" autoFocus/>
    <select style={s.inp} value={grupo} onChange={e=>setGrupo(e.target.value)}>
      <option value="projinternos">Proj. Internos</option>
      <option value="verificadores">Verificadores</option>
      <option value="projexternos">Proj. Externos</option>
    </select>
    <div style={{display:'flex',gap:8}}>
      <button style={s.btn} onClick={onClose}>Cancelar</button>
      <button style={s.btnGreen} onClick={()=>onSave(nome,grupo)}>Salvar</button>
    </div>
  </>
}

function ModalContrato({title,data,onSave,onClose,s,brand}){
  const [num,setNum]=useState(data?.num||'')
  const [etapa,setEtapa]=useState(data?.etapa||'')
  const [pecas,setPecas]=useState('')
  return <>
    <div style={{fontWeight:700,marginBottom:14,fontSize:14}}>{title}</div>
    <input style={s.inp} value={num} onChange={e=>setNum(e.target.value)} placeholder="Número (ex: 2455)" autoFocus/>
    <input style={s.inp} value={etapa} onChange={e=>setEtapa(e.target.value)} placeholder="Etapa (ex: Unicev)"/>
    {!data && <>
      <input style={s.inp} value={pecas} onChange={e=>setPecas(e.target.value)} placeholder="Pilar, Viga, Terça, Patrão"/>
      <div style={{fontSize:10,color:brand?.textMuted,marginBottom:8,marginTop:-4}}>Tipos de peça separados por vírgula</div>
    </>}
    <div style={{display:'flex',gap:8}}>
      <button style={s.btn} onClick={onClose}>Cancelar</button>
      <button style={s.btnBlue} onClick={()=>onSave(num,etapa,pecas)}>Salvar</button>
    </div>
  </>
}