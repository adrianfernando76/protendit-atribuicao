import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from './supabase'

const BRAND = {
  bg:'#f0f2f5', bgCard:'#ffffff', bgHeader:'#ffffff',
  bgPessoas:'#eef4ff', bgContratos:'#f0faf5',
  border:'#e2e8f0', blue:'#1A3A5C', blueMid:'#2196F3',
  teal:'#26A69A', green:'#4CAF50', amber:'#F59E0B',
  text:'#1a202c', textMuted:'#718096', textDim:'#cbd5e0',
}

const GRUPOS = {
  projinternos:  {label:'Proj. Internos', cor:'#2196F3', bg:'#dbeafe', bd:'#93c5fd'},
  verificadores: {label:'Verificadores',  cor:'#26A69A', bg:'#ccfbf1', bd:'#6ee7b7'},
  projexternos:  {label:'Proj. Externos', cor:'#4CAF50', bg:'#dcfce7', bd:'#86efac'},
}

let zCounter = 100

export default function App() {
  const [pessoas, setPessoas]     = useState([])
  const [contratos, setContratos] = useState([])
  const [vinculos, setVinculos]   = useState([])
  const [sel, setSel]             = useState([])
  const [modal, setModal]         = useState(null)
  const [arrows, setArrows]       = useState([])
  const [zoom, setZoom]           = useState(1)
  const [showDash, setShowDash]   = useState(false)
  const [filterGrp, setFilterGrp] = useState('todos')
  const [filterCt, setFilterCt]   = useState('todos')
  const [filterImp, setFilterImp] = useState(false)
  const [mode, setMode]           = useState('move')
  const [strokes, setStrokes]     = useState([])
  const [curStroke, setCurStroke] = useState([])
  const [drawing, setDrawing]     = useState(false)
  const [penColor, setPenColor]   = useState('#e53e3e')
  const [penSize, setPenSize]     = useState(3)
  const [zMap, setZMap]           = useState({})
  const wrapRef  = useRef(null)
  const dragRef  = useRef(null)
  const atimerRef = useRef(null)
  const zoomRef  = useRef(1)
  useEffect(() => { zoomRef.current = zoom }, [zoom])

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
    if (atimerRef.current) clearTimeout(atimerRef.current)
    atimerRef.current = setTimeout(calcArrows, 80)
  }
  useEffect(() => { schedArrows() }, [vinculos, pessoas, contratos, sel, zoom])
  useEffect(() => { window.addEventListener('resize', schedArrows); return () => window.removeEventListener('resize', schedArrows) }, [])

  function calcArrows() {
    if (!wrapRef.current || sel.length === 0) { setArrows([]); return }
    const rect = wrapRef.current.getBoundingClientRect()
    const boxes = []
    wrapRef.current.querySelectorAll('.dc').forEach(el => {
      const r = el.getBoundingClientRect()
      boxes.push({id:el.id, x:r.left-rect.left, y:r.top-rect.top, w:r.width, h:r.height})
    })
    const result = []
    vinculos.forEach(v => {
      if (!sel.includes(v.pessoa_id)) return
      const pEl = document.getElementById('c-'+v.pessoa_id)
      const pcEl = document.getElementById('pec-'+v.peca_id)
      if (!pEl||!pcEl) return
      const pR=pEl.getBoundingClientRect(), pcR=pcEl.getBoundingClientRect()
      const x1=pR.right-rect.left, y1=pR.top+pR.height/2-rect.top
      const x2=pcR.left-rect.left, y2=pcR.top+pcR.height/2-rect.top
      const mx=(x1+x2)/2, my=(y1+y2)/2
      let col=null
      boxes.forEach(b=>{
        if(b.id==='c-'+v.pessoa_id) return
        if(mx>b.x+8&&mx<b.x+b.w-8&&my>b.y+8&&my<b.y+b.h-8) col=b
      })
      result.push({x1,y1,x2,y2,mx,my,safeY:col?col.y-18:null})
    })
    setArrows(result)
  }

  function pessoaLinks(pid) {
    return vinculos.filter(v=>v.pessoa_id===pid).map(v=>{
      for (const ct of contratos) {
        const pc=ct.pecas.find(p=>p.id===v.peca_id)
        if(pc) return {label:`${ct.num} ${ct.etapa} / ${pc.nome}`, vid:v.id}
      }
      return null
    }).filter(Boolean)
  }

  function bumpZ(id) {
    const z = ++zCounter
    setZMap(prev=>({...prev,[id]:z}))
  }

  async function removeVinculo(vid, e) {
    e.stopPropagation()
    setVinculos(prev=>prev.filter(v=>v.id!==vid))
    await supabase.from('vinculos').delete().eq('id',vid)
  }

  async function toggleLink(pecaId) {
    if (!sel.length) return
    const pid = sel.find(s=>pessoas.some(p=>p.id===s))
    if (!pid) return
    const exists = vinculos.find(v=>v.pessoa_id===pid&&v.peca_id===pecaId)
    if (exists) {
      setVinculos(prev=>prev.filter(v=>v.id!==exists.id))
      await supabase.from('vinculos').delete().eq('id',exists.id)
    } else {
      setVinculos(prev=>[...prev,{pessoa_id:pid,peca_id:pecaId,id:'tmp-'+Date.now()}])
      await supabase.from('vinculos').insert({pessoa_id:pid,peca_id:pecaId})
    }
  }

  function toggleSel(id, e) {
    e.stopPropagation()
    bumpZ(id)
    if (e.ctrlKey||e.metaKey) setSel(prev=>prev.includes(id)?prev.filter(s=>s!==id):[...prev,id])
    else setSel(prev=>prev.length===1&&prev[0]===id?[]:[id])
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
    const lista = pessoas.filter(p=>p.grupo===grupo)
    const lastY = lista.length ? Math.max(...lista.map(p=>p.pos_y||0))+110 : 20
    const tmp = {id:'tmp-'+Date.now(),nome:nome.trim(),grupo,pos_x:20,pos_y:lastY,criado_em:new Date().toISOString()}
    setPessoas(prev=>[...prev,tmp])
    await supabase.from('pessoas').insert({nome:nome.trim(),grupo,pos_x:20,pos_y:lastY})
    setModal(null)
  }

  async function saveContrato(num, etapa, pecasStr) {
    if (!num.trim()||!etapa.trim()) return
    const wrap = wrapRef.current
    const cx = wrap ? (wrap.scrollLeft + wrap.clientWidth/2) / zoomRef.current : 700
    const cy = wrap ? (wrap.scrollTop + wrap.clientHeight/2) / zoomRef.current : 20
    const {data:ct} = await supabase.from('contratos').insert({num:num.trim(),etapa:etapa.trim(),pos_x:cx-80,pos_y:cy-60,importante:false}).select().single()
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
    if (!ct) return
    const ordem = ct.pecas.length
    const {data:pc} = await supabase.from('pecas').insert({contrato_id:ctId,nome:nome.trim(),ordem}).select().single()
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
    setSel(prev=>prev.filter(s=>s!==id))
    await supabase.from('pessoas').delete().eq('id',id)
  }

  async function delContrato(id) {
    const pcIds = contratos.find(c=>c.id===id)?.pecas.map(p=>p.id)||[]
    setContratos(prev=>prev.filter(c=>c.id!==id))
    setVinculos(prev=>prev.filter(v=>!pcIds.includes(v.peca_id)))
    await supabase.from('contratos').delete().eq('id',id)
  }

  async function autoOrganize(onlySelected=false) {
    const GAP=14, SX=20, SY=20
    let y=SY
    const updates=[]
    const grpOrder=['projinternos','verificadores','projexternos']
    grpOrder.forEach(grp=>{
      const lista=pessoas.filter(p=>p.grupo===grp&&(!onlySelected||sel.includes(p.id)))
      lista.forEach(p=>{
        updates.push({table:'pessoas',id:p.id,pos_x:SX,pos_y:y})
        y+=80+pessoaLinks(p.id).length*22+GAP
      })
      if(lista.length) y+=20
    })
    const ctList=contratos.filter(ct=>!onlySelected||sel.includes(ct.id))
    let cy=SY
    ctList.forEach((ct,i)=>{
      const col=Math.floor(i/6), row=i%6
      if(row===0) cy=SY
      updates.push({table:'contratos',id:ct.id,pos_x:700+col*185,pos_y:cy})
      cy+=52+ct.pecas.length*30+GAP
    })
    setPessoas(prev=>prev.map(p=>{const u=updates.find(u=>u.table==='pessoas'&&u.id===p.id);return u?{...p,pos_x:u.pos_x,pos_y:u.pos_y}:p}))
    setContratos(prev=>prev.map(c=>{const u=updates.find(u=>u.table==='contratos'&&u.id===c.id);return u?{...c,pos_x:u.pos_x,pos_y:u.pos_y}:c}))
    setTimeout(()=>{
      updates.forEach(u=>{const el=document.getElementById('c-'+u.id);if(el){el.style.left=u.pos_x+'px';el.style.top=u.pos_y+'px'}})
      schedArrows()
    },30)
    for(const u of updates) await supabase.from(u.table).update({pos_x:u.pos_x,pos_y:u.pos_y}).eq('id',u.id)
  }

  // ZOOM wheel
  useEffect(()=>{
    const el=wrapRef.current; if(!el) return
    const fn=e=>{
      if(!e.ctrlKey) return
      e.preventDefault()
      setZoom(z=>Math.min(2,Math.max(0.25,z-e.deltaY*0.001)))
    }
    el.addEventListener('wheel',fn,{passive:false})
    return()=>el.removeEventListener('wheel',fn)
  },[])

  // DRAG
  function startDrag(e, id) {
    if (mode==='draw') return
    const cx=e.touches?e.touches[0].clientX:e.clientX
    const cy=e.touches?e.touches[0].clientY:e.clientY
    if(!e.touches&&e.button!==0) return
    bumpZ(id)
    const dragIds = sel.includes(id)&&sel.length>1?sel:[id]
    const offsets=dragIds.map(did=>{
      const el=document.getElementById('c-'+did)
      return {id:did,el,sl:parseFloat(el?.style.left)||0,st:parseFloat(el?.style.top)||0}
    })
    dragRef.current={offsets,cx,cy,moved:false}
    e.stopPropagation(); e.preventDefault?.()
  }

  useEffect(()=>{
    const mm=e=>{
      if(!dragRef.current) return
      const cx=e.touches?e.touches[0].clientX:e.clientX
      const cy=e.touches?e.touches[0].clientY:e.clientY
      const dx=(cx-dragRef.current.cx)/zoomRef.current
      const dy=(cy-dragRef.current.cy)/zoomRef.current
      dragRef.current.offsets.forEach(o=>{
        const nx=Math.max(0,o.sl+dx), ny=Math.max(0,o.st+dy)
        if(o.el){o.el.style.left=nx+'px';o.el.style.top=ny+'px'}
        o.nx=nx; o.ny=ny
      })
      dragRef.current.moved=true
      schedArrows()
    }
    const mu=async()=>{
      if(!dragRef.current) return
      const {offsets,moved}=dragRef.current; dragRef.current=null
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
    window.addEventListener('mousemove',mm)
    window.addEventListener('mouseup',mu)
    window.addEventListener('touchmove',mm,{passive:false})
    window.addEventListener('touchend',mu)
    return()=>{
      window.removeEventListener('mousemove',mm)
      window.removeEventListener('mouseup',mu)
      window.removeEventListener('touchmove',mm)
      window.removeEventListener('touchend',mu)
    }
  },[pessoas,contratos,sel])

  // DRAW
  function getPos(e){
    const r=wrapRef.current.getBoundingClientRect()
    const cx=e.touches?e.touches[0].clientX:e.clientX
    const cy=e.touches?e.touches[0].clientY:e.clientY
    return {x:(cx-r.left)/zoom, y:(cy-r.top)/zoom}
  }
  function drawStart(e){if(mode!=='draw')return;e.preventDefault();setDrawing(true);setCurStroke([getPos(e)])}
  function drawMove(e){if(!drawing||mode!=='draw')return;e.preventDefault();setCurStroke(p=>[...p,getPos(e)])}
  function drawEnd(){if(!drawing)return;setDrawing(false);if(curStroke.length>1)setStrokes(p=>[...p,{pts:curStroke,color:penColor,size:penSize}]);setCurStroke([])}
  function pts2path(pts){return pts.map((p,i)=>i===0?`M${p.x},${p.y}`:`L${p.x},${p.y}`).join(' ')}

  // EXPORT PDF
  async function exportPDF(){
    const {jsPDF}=await import('https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js')
    const doc=new jsPDF({orientation:'landscape',unit:'mm',format:'a4'})
    doc.setFont('helvetica','bold');doc.setFontSize(16)
    doc.text('Atribuição de Peças — Protendit',14,15)
    doc.setFont('helvetica','normal');doc.setFontSize(10)
    doc.text(`Gerado em ${new Date().toLocaleDateString('pt-BR')}`,14,22)
    let y=32
    const grps=['projinternos','verificadores','projexternos']
    grps.forEach(grp=>{
      const lista=pessoas.filter(p=>p.grupo===grp)
      if(!lista.length) return
      doc.setFont('helvetica','bold');doc.setFontSize(11)
      doc.text(GRUPOS[grp].label,14,y);y+=6
      lista.forEach(p=>{
        const links=pessoaLinks(p.id)
        doc.setFont('helvetica','bold');doc.setFontSize(10)
        doc.text(`• ${p.nome}`,18,y);y+=5
        links.forEach(l=>{
          doc.setFont('helvetica','normal');doc.setFontSize(9)
          doc.text(`  — ${l.label}`,22,y);y+=4
        })
        if(!links.length){doc.setFont('helvetica','italic');doc.setFontSize(9);doc.text('  sem vínculos',22,y);y+=4}
        if(y>185){doc.addPage();y=20}
      })
      y+=4
    })
    doc.save('atribuicao-protendit.pdf')
  }

  // DASHBOARD
  const dash={
    totalP:pessoas.length, totalC:contratos.length, totalV:vinculos.length,
    porGrupo:Object.keys(GRUPOS).map(g=>({
      label:GRUPOS[g].label,cor:GRUPOS[g].cor,
      count:pessoas.filter(p=>p.grupo===g).length,
      vc:vinculos.filter(v=>pessoas.find(p=>p.id===v.pessoa_id&&p.grupo===g)).length
    })),
    semVinculo:pessoas.filter(p=>!vinculos.some(v=>v.pessoa_id===p.id)).length,
    top:pessoas.map(p=>({nome:p.nome,n:vinculos.filter(v=>v.pessoa_id===p.id).length})).sort((a,b)=>b.n-a.n).slice(0,5)
  }

  const isSel=id=>sel.includes(id)
  const pessoasF=pessoas.filter(p=>filterGrp==='todos'||p.grupo===filterGrp)
  const contratosF=contratos.filter(ct=>(filterCt==='todos'||ct.id===filterCt)&&(!filterImp||ct.importante))

  const S={
    app:{background:BRAND.bg,width:'100vw',height:'100vh',fontFamily:"'Segoe UI',sans-serif",fontSize:13,color:BRAND.text,display:'flex',flexDirection:'column',overflow:'hidden',position:'fixed',top:0,left:0},
    top:{display:'flex',alignItems:'center',gap:6,padding:'7px 14px',borderBottom:`1px solid ${BRAND.border}`,background:BRAND.bgHeader,zIndex:100,flexShrink:0,flexWrap:'wrap'},
    wrap:{flex:1,overflow:'auto',position:'relative',cursor:mode==='draw'?'crosshair':'default'},
    canvas:{position:'absolute',width:4000,height:3000,transformOrigin:'0 0',transform:`scale(${zoom})`},
    card:id=>({background:BRAND.bgCard,border:`1px solid ${isSel(id)?BRAND.blueMid:BRAND.border}`,boxShadow:isSel(id)?`0 0 0 2px ${BRAND.blueMid}33`:'0 1px 3px rgba(0,0,0,.07)',borderRadius:10,padding:'9px 11px',width:188,position:'relative'}),
    ctCard:id=>({background:BRAND.bgCard,border:`1px solid ${isSel(id)?BRAND.blueMid:BRAND.border}`,boxShadow:isSel(id)?`0 0 0 2px ${BRAND.blueMid}33`:'0 1px 3px rgba(0,0,0,.07)',borderRadius:10,width:164,overflow:'hidden',position:'relative'}),
    btn:{fontSize:11,padding:'4px 9px',borderRadius:6,border:`1px solid ${BRAND.border}`,background:'transparent',color:BRAND.textMuted,cursor:'pointer'},
    btnB:{fontSize:11,padding:'4px 9px',borderRadius:6,border:`1px solid ${BRAND.blueMid}`,background:`${BRAND.blueMid}15`,color:BRAND.blueMid,cursor:'pointer'},
    btnG:{fontSize:11,padding:'4px 9px',borderRadius:6,border:`1px solid ${BRAND.green}`,background:`${BRAND.green}15`,color:BRAND.green,cursor:'pointer'},
    btnA:a=>({fontSize:11,padding:'4px 9px',borderRadius:6,border:`1px solid ${a?BRAND.blueMid:BRAND.border}`,background:a?`${BRAND.blueMid}20`:'transparent',color:a?BRAND.blueMid:BRAND.textMuted,cursor:'pointer'}),
    peca:l=>({padding:'5px 10px',borderBottom:`1px solid ${BRAND.border}`,cursor:'pointer',background:l?'#f0fdf4':'transparent',color:l?BRAND.teal:BRAND.textMuted,display:'flex',alignItems:'center',gap:6,fontSize:12,transition:'background .1s'}),
    dot:l=>({width:6,height:6,borderRadius:'50%',background:l?BRAND.teal:BRAND.border,flexShrink:0}),
    modal:{position:'fixed',inset:0,background:'rgba(0,0,0,.5)',zIndex:200,display:'flex',alignItems:'center',justifyContent:'center'},
    mbox:{background:'#fff',border:`1px solid ${BRAND.border}`,borderRadius:12,padding:22,width:360,boxShadow:'0 8px 32px rgba(0,0,0,.15)',maxHeight:'80vh',overflowY:'auto'},
    inp:{width:'100%',marginBottom:8,background:'#fff',border:`1px solid ${BRAND.border}`,color:BRAND.text,borderRadius:6,padding:'7px 10px',fontSize:12,outline:'none'},
  }

  return (
    <div style={S.app} onClick={()=>setSel([])}>
      {/* TOPBAR */}
      <div style={S.top} onClick={e=>e.stopPropagation()}>
        <div style={{display:'flex',alignItems:'center',gap:7,marginRight:6}}>
          <div style={{width:28,height:28,background:`linear-gradient(135deg,${BRAND.blue},${BRAND.blueMid})`,borderRadius:7,display:'flex',alignItems:'center',justifyContent:'center',fontWeight:800,fontSize:14,color:'#fff',flexShrink:0}}>P</div>
          <div>
            <div style={{fontWeight:700,fontSize:12,lineHeight:1.2}}>Atribuição de Peças</div>
            <div style={{fontSize:9,color:BRAND.textMuted}}>Protendit Construções</div>
          </div>
        </div>

        <select style={S.btn} value={filterGrp} onChange={e=>setFilterGrp(e.target.value)}>
          <option value="todos">Todos os grupos</option>
          <option value="projinternos">Proj. Internos</option>
          <option value="verificadores">Verificadores</option>
          <option value="projexternos">Proj. Externos</option>
        </select>

        <select style={S.btn} value={filterCt} onChange={e=>setFilterCt(e.target.value)}>
          <option value="todos">Todos contratos</option>
          {contratos.map(ct=><option key={ct.id} value={ct.id}>{ct.num} {ct.etapa}</option>)}
        </select>

        <button style={S.btnA(filterImp)} onClick={()=>setFilterImp(p=>!p)}>⭐ Importantes</button>

        <div style={{display:'flex',gap:3,background:BRAND.bg,borderRadius:7,padding:3,border:`1px solid ${BRAND.border}`}}>
          <button style={S.btnA(mode==='move')} onClick={()=>setMode('move')}>✥ Mover</button>
          <button style={S.btnA(mode==='draw')} onClick={()=>setMode('draw')}>✏ Caneta</button>
        </div>

        {mode==='draw'&&<>
          <input type="color" value={penColor} onChange={e=>setPenColor(e.target.value)} style={{width:26,height:26,border:'none',borderRadius:5,cursor:'pointer',padding:0}}/>
          <input type="range" min={1} max={12} value={penSize} onChange={e=>setPenSize(+e.target.value)} style={{width:55}}/>
          <button style={S.btn} onClick={()=>setStrokes([])}>🗑</button>
        </>}

        <div style={{display:'flex',gap:3,marginLeft:'auto'}}>
          <button style={S.btn} onClick={()=>setZoom(z=>Math.min(2,z+0.1))}>＋</button>
          <button style={{...S.btn,minWidth:40,textAlign:'center'}} onClick={()=>setZoom(1)}>{Math.round(zoom*100)}%</button>
          <button style={S.btn} onClick={()=>setZoom(z=>Math.max(0.25,z-0.1))}>－</button>
        </div>

        {sel.length>0&&<button style={S.btnB} onClick={()=>autoOrganize(true)}>⊞ Org. sel.</button>}
        <button style={S.btn} onClick={()=>autoOrganize(false)}>⊞ Organizar</button>
        <button style={S.btn} onClick={()=>setModal({type:'add-pessoa'})}>+ Pessoa</button>
        <button style={S.btnG} onClick={()=>setModal({type:'add-contrato'})}>+ Contrato</button>
        <button style={S.btn} onClick={()=>setShowDash(true)}>📊</button>
        <button style={S.btn} onClick={exportPDF}>⬇ PDF</button>
      </div>

      {/* CANVAS */}
      <div style={S.wrap} ref={wrapRef}
        onMouseDown={mode==='draw'?drawStart:undefined}
        onMouseMove={mode==='draw'?drawMove:undefined}
        onMouseUp={mode==='draw'?drawEnd:undefined}
        onTouchStart={mode==='draw'?drawStart:undefined}
        onTouchMove={mode==='draw'?drawMove:undefined}
        onTouchEnd={mode==='draw'?drawEnd:undefined}>
        <div style={S.canvas}>

          {/* Áreas de fundo */}
          <div style={{position:'absolute',left:0,top:0,width:670,height:3000,background:BRAND.bgPessoas,borderRight:`2px dashed ${BRAND.border}`,pointerEvents:'none'}}/>
          <div style={{position:'absolute',left:670,top:0,width:3330,height:3000,background:BRAND.bgContratos,pointerEvents:'none'}}/>
          <div style={{position:'absolute',left:10,top:8,fontSize:10,fontWeight:600,color:BRAND.blueMid,textTransform:'uppercase',letterSpacing:'.06em',pointerEvents:'none'}}>Equipe</div>
          <div style={{position:'absolute',left:680,top:8,fontSize:10,fontWeight:600,color:BRAND.teal,textTransform:'uppercase',letterSpacing:'.06em',pointerEvents:'none'}}>Contratos / Etapas</div>

          {/* SVG setas + rabiscos */}
          <svg style={{position:'absolute',top:0,left:0,width:'100%',height:'100%',pointerEvents:'none',zIndex:5,overflow:'visible'}}>
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M2 1L8 5L2 9" fill="none" stroke={BRAND.teal} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </marker>
            </defs>
            {arrows.map((a,i)=>{
              const d=a.safeY!==null
                ?`M${a.x1} ${a.y1} C${a.mx} ${a.y1} ${a.mx} ${a.safeY} ${a.mx} ${a.safeY} C${a.mx} ${a.safeY} ${a.mx} ${a.y2} ${a.x2} ${a.y2}`
                :`M${a.x1} ${a.y1} C${a.mx} ${a.y1} ${a.mx} ${a.y2} ${a.x2} ${a.y2}`
              return <path key={i} d={d} fill="none" stroke={BRAND.teal} strokeWidth="1.5" opacity=".75" markerEnd="url(#arr)"/>
            })}
            {strokes.map((s,i)=><path key={i} d={pts2path(s.pts)} fill="none" stroke={s.color} strokeWidth={s.size} strokeLinecap="round" strokeLinejoin="round" opacity=".85"/>)}
            {drawing&&curStroke.length>1&&<path d={pts2path(curStroke)} fill="none" stroke={penColor} strokeWidth={penSize} strokeLinecap="round" strokeLinejoin="round"/>}
          </svg>

          {/* PESSOAS */}
          {pessoasF.map(p=>{
            const grp=GRUPOS[p.grupo]||GRUPOS.projinternos
            const links=pessoaLinks(p.id)
            const expanded=isSel(p.id)
            return (
              <div key={p.id} id={'c-'+p.id} className="dc"
                style={{position:'absolute',left:p.pos_x||20,top:p.pos_y||20,zIndex:zMap[p.id]||10,touchAction:'none'}}
                onMouseDown={e=>startDrag(e,p.id)}
                onTouchStart={e=>startDrag(e,p.id)}
                onClick={e=>{e.stopPropagation();toggleSel(p.id,e)}}>
                <div style={S.card(p.id)}>
                  <div style={{display:'flex',alignItems:'center',gap:4,marginBottom:3}}>
                    <span style={{fontWeight:600,color:BRAND.text,flex:1,fontSize:13,userSelect:'none'}}>{p.nome}</span>
                    {links.length>0&&!expanded&&<span style={{fontSize:10,padding:'1px 6px',borderRadius:99,background:grp.bg,color:grp.cor,border:`1px solid ${grp.bd}`,fontWeight:600,flexShrink:0}}>{links.length}</span>}
                    <span style={{color:BRAND.textMuted,fontSize:12,cursor:'pointer',flexShrink:0}} onClick={e=>{e.stopPropagation();setModal({type:'edit-pessoa',data:p})}}>✎</span>
                    <span style={{color:BRAND.textMuted,fontSize:15,cursor:'pointer',flexShrink:0}} onClick={e=>{e.stopPropagation();delPessoa(p.id)}}>×</span>
                  </div>
                  <div style={{fontSize:10,color:grp.cor,fontWeight:600}}>{grp.label}</div>
                  {expanded&&links.length>0&&(
                    <div style={{display:'flex',flexDirection:'column',gap:2,marginTop:5}}>
                      {links.map((t,i)=>(
                        <span key={i} style={{fontSize:10,padding:'2px 7px',borderRadius:4,background:grp.bg,color:grp.cor,border:`1px solid ${grp.bd}`,display:'flex',alignItems:'center',gap:4}}>
                          <span style={{flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{t.label}</span>
                          <span style={{cursor:'pointer',fontWeight:700,opacity:.6,flexShrink:0}} onClick={e=>removeVinculo(t.vid,e)}>×</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {/* CONTRATOS */}
          {contratosF.map(ct=>{
            const temVinculos=ct.pecas.some(pc=>vinculos.some(v=>v.peca_id===pc.id))
            const imp=ct.importante
            return (
              <div key={ct.id} id={'c-'+ct.id} className="dc"
                style={{position:'absolute',left:ct.pos_x||700,top:ct.pos_y||20,zIndex:zMap[ct.id]||10,touchAction:'none'}}
                onMouseDown={e=>startDrag(e,ct.id)}
                onTouchStart={e=>startDrag(e,ct.id)}
                onClick={e=>{e.stopPropagation();toggleSel(ct.id,e)}}>
                <div style={{...S.ctCard(ct.id),opacity:temVinculos?1:0.7,borderLeft:imp?`3px solid ${BRAND.amber}`:undefined}}>
                  {/* Estrela importante */}
                  <div style={{position:'absolute',top:6,right:6,cursor:'pointer',fontSize:14,color:imp?BRAND.amber:BRAND.textDim,zIndex:2}}
                    onClick={e=>{e.stopPropagation();toggleImportante(ct.id,e)}}>
                    {imp?'★':'☆'}
                  </div>
                  <div style={{padding:'8px 28px 8px 10px',background:temVinculos?`${BRAND.teal}10`:BRAND.bgHeader,borderBottom:`1px solid ${BRAND.border}`}}>
                    <div style={{fontWeight:700,color:BRAND.blueMid,fontSize:11,letterSpacing:'.04em'}}>
                      {ct.num.toUpperCase().startsWith('CT')?ct.num.toUpperCase():'CT '+ct.num.toUpperCase()}
                    </div>
                    <div style={{fontWeight:700,color:BRAND.text,fontSize:13,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{ct.etapa.toUpperCase()}</div>
                    <div style={{display:'flex',gap:4,marginTop:4,alignItems:'center'}}>
                      <span style={{fontSize:10,cursor:'pointer',color:BRAND.textMuted}} onClick={e=>{e.stopPropagation();setModal({type:'edit-contrato',data:ct})}}>✎</span>
                      <span style={{fontSize:10,cursor:'pointer',color:BRAND.textMuted}} onClick={e=>{e.stopPropagation();setModal({type:'edit-pecas',data:ct})}}>+ peças</span>
                      <span style={{marginLeft:'auto',fontSize:14,cursor:'pointer',color:BRAND.textMuted}} onClick={e=>{e.stopPropagation();delContrato(ct.id)}}>×</span>
                    </div>
                  </div>
                  {ct.pecas.map(pc=>{
                    const linked=vinculos.some(v=>v.peca_id===pc.id)
                    return (
                      <div key={pc.id} id={'pec-'+pc.id} style={S.peca(linked)}
                        onClick={e=>{e.stopPropagation();toggleLink(pc.id)}}>
                        <div style={S.dot(linked)}/>{pc.nome}
                      </div>
                    )
                  })}
                </div>
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
                <div key={i} style={{background:BRAND.bg,border:`1px solid ${BRAND.border}`,borderRadius:10,padding:'12px',textAlign:'center'}}>
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
    <div style={{fontSize:11,color:brand?.textMuted,marginBottom:12}}>Clique × para remover uma peça</div>
    <div style={{display:'flex',flexDirection:'column',gap:4,marginBottom:12,maxHeight:200,overflowY:'auto'}}>
      {ct.pecas.map(pc=>(
        <div key={pc.id} style={{display:'flex',alignItems:'center',gap:6,padding:'5px 8px',background:'#f8f9fa',borderRadius:6,border:'1px solid #e2e8f0'}}>
          <span style={{flex:1,fontSize:12}}>{pc.nome}</span>
          <span style={{cursor:'pointer',color:'#999',fontWeight:700,fontSize:14}} onClick={()=>onDel(ct.id,pc.id)}>×</span>
        </div>
      ))}
      {ct.pecas.length===0&&<div style={{fontSize:11,color:brand?.textMuted}}>Nenhuma peça cadastrada</div>}
    </div>
    <div style={{display:'flex',gap:6,marginBottom:12}}>
      <input style={{...S.inp,marginBottom:0,flex:1}} value={nova} onChange={e=>setNova(e.target.value)} placeholder="Nova peça..." onKeyDown={e=>{if(e.key==='Enter'&&nova.trim()){onAdd(ct.id,nova);setNova('')}}}/>
      <button style={S.btnG} onClick={()=>{if(nova.trim()){onAdd(ct.id,nova);setNova('')}}}>+ Add</button>
    </div>
    <button style={S.btn} onClick={onClose}>Fechar</button>
  </>
}