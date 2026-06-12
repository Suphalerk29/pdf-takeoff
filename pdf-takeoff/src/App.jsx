// App.jsx — PDF Construction Takeoff (v2)
// Updates: tab persistence, zoom fix, Ctrl+scroll, Space pan, A/D/F shortcuts,
//          click-item popup, item shape/color edit, autosave, toast, scan-append mode, themes

import { useState, useRef, useEffect, useCallback } from 'react'
import * as PDFJS from 'pdfjs-dist'
import { useOpenCV } from './hooks/useOpenCV'
import * as XLSX from 'xlsx'

PDFJS.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const SCALE = 2.0
const SYMBOL_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#84CC16']
const SHAPES = ['rect', 'circle', 'diamond']
const LS_KEY = 'pdf-takeoff-v2'
const THEMES = {
  light: {
    bg: '#F8FAFC', sidebar: '#FFFFFF', border: '#E2E8F0',
    text: '#1E293B', textSub: '#64748B', textHint: '#94A3B8',
    active: '#EFF6FF', activeText: '#1D4ED8', activeBorder: '#BFDBFE',
    header: '#FFFFFF', canvas: '#CBD5E1',
    btn: '#F1F5F9', btnHover: '#E2E8F0',
  },
  dark: {
    bg: '#0F172A', sidebar: '#1E293B', border: '#334155',
    text: '#F1F5F9', textSub: '#94A3B8', textHint: '#475569',
    active: '#1E3A5F', activeText: '#60A5FA', activeBorder: '#1D4ED8',
    header: '#1E293B', canvas: '#0F172A',
    btn: '#334155', btnHover: '#475569',
  },
  hc: {
    bg: '#000000', sidebar: '#000000', border: '#FFFFFF',
    text: '#FFFFFF', textSub: '#CCCCCC', textHint: '#999999',
    active: '#FFFFFF', activeText: '#000000', activeBorder: '#FFFFFF',
    header: '#111111', canvas: '#222222',
    btn: '#333333', btnHover: '#444444',
  },
}

function loadState() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || {} } catch { return {} }
}
function saveState(s) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(s)) } catch {}
}

export default function App() {
  const saved = useRef(loadState())

  // --- theme ---
  const [themeName, setThemeName] = useState(saved.current.theme || 'light')
  const T = THEMES[themeName] || THEMES.light

  // --- projects ---
  const [projects, setProjects] = useState(saved.current.projects || [])
  const [activeProjectId, setActiveProjectId] = useState(null)
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')

  // --- PDF ---
  const [pdfDoc, setPdfDoc] = useState(null)
  const [pageNum, setPageNum] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [pdfFileName, setPdfFileName] = useState('')
  const [rendering, setRendering] = useState(false)

  // --- view ---
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [tool, setTool] = useState('select')
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState(null)
  const [spaceDown, setSpaceDown] = useState(false)
  const [tab, setTab] = useState('canvas')

  // --- drawing ---
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState(null)
  const [drawBox, setDrawBox] = useState(null)
  const [showNamePopup, setShowNamePopup] = useState(false)
  const [pendingBox, setPendingBox] = useState(null)
  const [newDeviceName, setNewDeviceName] = useState('')
  const [newDeviceColor, setNewDeviceColor] = useState(SYMBOL_COLORS[0])
  const [newDeviceShape, setNewDeviceShape] = useState('rect')

  // --- symbols & detections ---
  const [symbols, setSymbols] = useState([])
  const [detections, setDetections] = useState([])
  const [threshold, setThreshold] = useState(60)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)
  const [scanMode, setScanMode] = useState('replace') // replace | append

  // --- item popup (click on canvas detection) ---
  const [itemPopup, setItemPopup] = useState(null) // { detId, screenX, screenY }
  // manual add
  const [manualBox, setManualBox] = useState(null)
  const [showManualPopup, setShowManualPopup] = useState(false)
  const [manualSymbolId, setManualSymbolId] = useState(null)

  // --- toast ---
  const [toast, setToast] = useState(null)

  // --- autosave ---
  const [lastSaved, setLastSaved] = useState(null)

  // --- summary ---
  const [summaryRows, setSummaryRows] = useState([])

  // --- refs ---
  const pdfCanvasRef = useRef(null)
  const containerRef = useRef(null)
  const fileInputRef = useRef(null)
  const zoomRef = useRef(zoom)
  const panRef = useRef(pan)
  zoomRef.current = zoom
  panRef.current = pan

  // ref เก็บค่าล่าสุดเพื่อใช้ใน event handler (หลีกเลี่ยง closure เก่า)
  const symbolsRef = useRef(symbols)
  symbolsRef.current = symbols
  const detectionsRef = useRef(detections)
  detectionsRef.current = detections
  const itemPopupRef = useRef(itemPopup)
  itemPopupRef.current = itemPopup

  const { ready: cvReady, loading: cvLoading, runTemplateMatch, extractRegion } = useOpenCV()

  // ── autosave every 30s ──
  useEffect(() => {
    const interval = setInterval(() => {
      saveState({ theme: themeName, projects })
      setLastSaved(new Date())
    }, 30000)
    return () => clearInterval(interval)
  }, [themeName, projects])

  // ── save theme immediately ──
  useEffect(() => {
    saveState({ theme: themeName, projects })
  }, [themeName])

  // ── keyboard shortcuts ──
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') { e.preventDefault(); setSpaceDown(true) }
      if (e.key === 'f' || e.key === 'F') fitScreen()
      if (e.key === 'a' || e.key === 'A') {
        const pending = detections.filter(d => d.status === 'pending')
        if (pending.length > 0) { approveDetection(pending[0].id); showToast(`✓ Approved`) }
      }
      if (e.key === 'd' || e.key === 'D') {
        const pending = detections.filter(d => d.status === 'pending')
        if (pending.length > 0) { rejectDetection(pending[0].id); showToast(`✕ Rejected`) }
      }
    }
    const onKeyUp = (e) => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => { window.removeEventListener('keydown', onKeyDown); window.removeEventListener('keyup', onKeyUp) }
  }, [detections])

  // ── Ctrl+Scroll zoom ──
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top
      const oldZoom = zoomRef.current
      const delta = e.deltaY > 0 ? -0.15 : 0.15
      const newZoom = Math.min(Math.max(oldZoom + delta, 0.25), 6)
      const newPanX = mouseX - (mouseX - panRef.current.x) * (newZoom / oldZoom)
      const newPanY = mouseY - (mouseY - panRef.current.y) * (newZoom / oldZoom)
      setZoom(newZoom)
      setPan({ x: newPanX, y: newPanY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  // ── render PDF page (always render even when tab hidden) ──
  const renderPage = useCallback(async (doc, page) => {
    if (!pdfCanvasRef.current || !doc) return
    setRendering(true)
    try {
      const pdfPage = await doc.getPage(page)
      const viewport = pdfPage.getViewport({ scale: SCALE })
      const canvas = pdfCanvasRef.current
      const ctx = canvas.getContext('2d')
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = viewport.width / SCALE + 'px'
      canvas.style.height = viewport.height / SCALE + 'px'
      await pdfPage.render({ canvasContext: ctx, viewport }).promise
    } finally {
      setRendering(false)
    }
  }, [])

  useEffect(() => {
    if (pdfDoc && pageNum) renderPage(pdfDoc, pageNum)
  }, [pdfDoc, pageNum, renderPage])

  // ── fit screen ──
  const fitScreen = useCallback(() => {
    if (!pdfCanvasRef.current || !containerRef.current) return
    const cw = containerRef.current.clientWidth
    const ch = containerRef.current.clientHeight
    const pw = pdfCanvasRef.current.width / SCALE
    const ph = pdfCanvasRef.current.height / SCALE
    const newZoom = Math.min(cw / pw, ch / ph) * 0.95
    setZoom(newZoom)
    setPan({ x: (cw - pw * newZoom) / 2, y: (ch - ph * newZoom) / 2 })
  }, [])

  // ── file upload ──
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPdfFileName(file.name)
    const buf = await file.arrayBuffer()
    const doc = await PDFJS.getDocument({ data: buf }).promise
    setPdfDoc(doc)
    setTotalPages(doc.numPages)
    setPageNum(1)
    setPan({ x: 0, y: 0 })
    setZoom(1)
  }

  // ── canvas coordinate (accounts for zoom + pan + SCALE) ──
  const getCanvasPos = useCallback((e) => {
    const canvas = pdfCanvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / zoom) * SCALE,
      y: ((e.clientY - rect.top) / zoom) * SCALE,
    }
  }, [zoom])

  // ── mouse: pan / crop / select ──
  const activeTool = spaceDown ? 'pan' : tool

  const handleMouseDown = (e) => {
    if (e.button !== 0) return
    setItemPopup(null)
    if (activeTool === 'crop') {
      const pos = getCanvasPos(e)
      setIsDrawing(true)
      setDrawStart(pos)
      setDrawBox({ x: pos.x, y: pos.y, w: 0, h: 0 })
    } else if (activeTool === 'pan') {
      setIsPanning(true)
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }

  const handleMouseMove = (e) => {
    if (isDrawing && activeTool === 'crop') {
      const pos = getCanvasPos(e)
      setDrawBox({
        x: Math.min(pos.x, drawStart.x),
        y: Math.min(pos.y, drawStart.y),
        w: Math.abs(pos.x - drawStart.x),
        h: Math.abs(pos.y - drawStart.y),
      })
    } else if (isPanning) {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
    }
  }

  const handleMouseUp = (e) => {
    if (isDrawing && drawBox && drawBox.w > 15 && drawBox.h > 15) {
      setIsDrawing(false)
      setPendingBox({ ...drawBox })
      if (symbolsRef.current.length > 0) {
        // มีสัญลักษณ์อยู่แล้ว — ให้เลือกว่าจะเพิ่ม manual หรือสร้างใหม่
        setManualBox({ ...drawBox })
        setManualSymbolId(symbolsRef.current[0].id)
        setShowManualPopup(true)
      } else {
        setShowNamePopup(true)
        setNewDeviceName('')
        setNewDeviceColor(SYMBOL_COLORS[0])
        setNewDeviceShape('rect')
      }
    } else if (isDrawing) {
      setIsDrawing(false)
      setDrawBox(null)
    }
    setIsPanning(false)

    // select tool: click on detection
    if (activeTool === 'select' && !isDrawing) {
      const pos = getCanvasPos(e)
      const hit = currentPageDetections.slice().reverse().find(d =>
        pos.x >= d.x && pos.x <= d.x + d.w && pos.y >= d.y && pos.y <= d.y + d.h
      )
      if (hit) {
        const rect = containerRef.current.getBoundingClientRect()
        setItemPopup({
          detId: hit.id,
          screenX: e.clientX - rect.left,
          screenY: e.clientY - rect.top,
        })
      }
    }
  }

  // ── save symbol ──
  const handleSaveSymbol = () => {
    if (!newDeviceName.trim() || !pendingBox || !pdfCanvasRef.current) return
    const templateCanvas = extractRegion(pdfCanvasRef.current, pendingBox.x, pendingBox.y, pendingBox.w, pendingBox.h)
    const newSym = {
      id: Date.now(),
      name: newDeviceName.trim(),
      color: newDeviceColor,
      shape: newDeviceShape,
      templateCanvas,
      templateDataUrl: templateCanvas.toDataURL(),
    }
    setSymbols(prev => [...prev, newSym])
    setSummaryRows(prev => [...prev, { id: newSym.id, name: newSym.name, color: newSym.color, qty: 0, wastage: 5, unitCost: 0, editingName: false, editingQty: false }])
    setShowNamePopup(false)
    setDrawBox(null)
    setPendingBox(null)
    setTool('select')
  }

  // ── run scan ──
  const runScan = async (mode = scanMode) => {
    if (!cvReady || !pdfDoc || symbols.length === 0) return
    setScanning(true)
    setScanProgress(0)

    // ปกป้อง approved เสมอทุก mode — ถ้า replace จะล้าง pending เก่าแต่เก็บ approved ไว้
    const approvedDetections = detections.filter(d => d.status === 'approved')
    const preserved = approvedDetections // ใช้ทุก mode
    const newDetections = mode === 'append' ? [...preserved] : [...preserved] // เริ่มจาก approved เสมอ
    const total = pdfDoc.numPages * symbols.length

    for (let page = 1; page <= pdfDoc.numPages; page++) {
      const offscreen = document.createElement('canvas')
      const pdfPage = await pdfDoc.getPage(page)
      const viewport = pdfPage.getViewport({ scale: SCALE })
      offscreen.width = viewport.width
      offscreen.height = viewport.height
      await pdfPage.render({ canvasContext: offscreen.getContext('2d'), viewport }).promise

      for (let si = 0; si < symbols.length; si++) {
        const sym = symbols[si]
        const matches = runTemplateMatch(offscreen, sym.templateCanvas, threshold / 100)
        matches.forEach(m => {
          // skip if overlaps with preserved detection
          const overlaps = preserved.some(p =>
            p.page === page && p.symbolId === sym.id &&
            Math.abs(p.x - m.x) < m.w * 0.5 && Math.abs(p.y - m.y) < m.h * 0.5
          )
          if (!overlaps) {
            newDetections.push({
              id: Date.now() + Math.random(),
              symbolId: sym.id,
              x: m.x, y: m.y, w: m.w, h: m.h,
              confidence: m.confidence,
              status: m.confidence >= threshold / 100 + 0.1 ? 'approved' : 'pending',
              page,
              shape: sym.shape || 'rect',
              color: sym.color,
            })
          }
        })
        setScanProgress(Math.round(((page - 1) * symbols.length + si + 1) / total * 100))
        await new Promise(r => setTimeout(r, 0))
      }
    }

    setDetections(newDetections)
    setSummaryRows(prev => prev.map(r => ({
      ...r, qty: newDetections.filter(d => d.symbolId === r.id && d.status === 'approved').length
    })))
    setScanning(false)

    const approved = newDetections.filter(d => d.status === 'approved').length
    const pending = newDetections.filter(d => d.status === 'pending').length
    showToast(`สแกนเสร็จ ✓${approved} รอตรวจ ${pending}`, 'info', () => setTab('review'))
  }

  // ── approve / reject ──
  const approveDetection = (id) => {
    setDetections(prev => {
      const next = prev.map(d => d.id === id ? { ...d, status: 'approved' } : d)
      setSummaryRows(sr => sr.map(r => ({ ...r, qty: next.filter(d => d.symbolId === r.id && d.status === 'approved').length })))
      return next
    })
  }

  const unapproveDetection = (id) => {
    setDetections(prev => {
      const next = prev.map(d => d.id === id ? { ...d, status: 'pending' } : d)
      setSummaryRows(sr => sr.map(r => ({ ...r, qty: next.filter(d => d.symbolId === r.id && d.status === 'approved').length })))
      return next
    })
  }

  const rejectDetection = (id) => {
    setDetections(prev => {
      const next = prev.filter(d => d.id !== id)
      setSummaryRows(sr => sr.map(r => ({ ...r, qty: next.filter(d => d.symbolId === r.id && d.status === 'approved').length })))
      return next
    })
    setItemPopup(null)
  }

  // ── update detection style ──
  const updateDetectionStyle = (id, patch) => {
    setDetections(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d))
  }

  // ── focus on canvas ──
  const focusDetection = useCallback((det) => {
    setPageNum(det.page)
    setTab('canvas')
    const TARGET_ZOOM = 2.5
    setZoom(TARGET_ZOOM)
    const containerW = containerRef.current?.clientWidth || 700
    const containerH = containerRef.current?.clientHeight || 500
    const cssCx = (det.x + det.w / 2) / SCALE
    const cssCy = (det.y + det.h / 2) / SCALE
    setPan({ x: containerW / 2 - cssCx * TARGET_ZOOM, y: containerH / 2 - cssCy * TARGET_ZOOM })
    setItemPopup(null)
    setTimeout(() => setItemPopup({
      detId: det.id,
      screenX: containerW / 2,
      screenY: containerH / 2,
    }), 300)
  }, [])

  // ── toast ──
  const toastTimer = useRef(null)
  const showToast = (msg, type = 'info', action = null) => {
    setToast({ msg, type, action })
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  // ── export Excel ──
  const exportExcel = () => {
    const rows = [['ชื่ออุปกรณ์', 'จำนวนนับ', 'เผื่อ (%)', 'จำนวนสุทธิ', 'ราคา/หน่วย (฿)', 'ราคารวม (฿)']]
    summaryRows.forEach(r => {
      const net = Math.round(r.qty * (1 + r.wastage / 100))
      rows.push([r.name, r.qty, r.wastage, net, r.unitCost, net * r.unitCost])
    })
    const total = summaryRows.reduce((a, r) => a + Math.round(r.qty * (1 + r.wastage / 100)) * r.unitCost, 0)
    rows.push(['รวมทั้งหมด', '', '', '', '', total])
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 28 }, { wch: 12 }, { wch: 18 }, { wch: 14 }, { wch: 18 }, { wch: 16 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Takeoff Summary')
    XLSX.writeFile(wb, `takeoff-${pdfFileName || 'summary'}.xlsx`)
  }

  // ── project ──
  const createProject = () => {
    if (!newProjectName.trim()) return
    const p = { id: Date.now(), name: newProjectName.trim(), symbols: [], detections: [], summaryRows: [], pdfFileName: '', pageNum: 1 }
    setProjects(prev => [...prev, p])
    setActiveProjectId(p.id)
    setNewProjectName('')
    setShowProjectModal(false)
    setSymbols([]); setDetections([]); setSummaryRows([])
  }

  const saveProject = () => {
    if (!activeProjectId) return
    setProjects(prev => prev.map(p => p.id === activeProjectId
      ? { ...p, symbols: symbols.map(s => ({ ...s, templateCanvas: undefined })), detections, summaryRows, pdfFileName, pageNum }
      : p
    ))
    showToast('บันทึกแล้ว ✓')
  }

  // ── computed ──
  const approvedDetections = detections.filter(d => d.status === 'approved')
  const pendingDetections = detections.filter(d => d.status === 'pending')
  const currentPageDetections = detections.filter(d => d.page === pageNum)
  const approvedCounts = {}
  approvedDetections.forEach(d => { approvedCounts[d.symbolId] = (approvedCounts[d.symbolId] || 0) + 1 })

  // ── cursor ──
  const isPanMode = activeTool === 'pan'
  const isCropMode = activeTool === 'crop'
  const cursorStyle = isPanning ? 'grabbing' : isPanMode ? 'grab' : isCropMode ? 'crosshair' : 'default'

  // ── detection shape renderer ──
  const DetectionShape = ({ d, isFocused }) => {
    const sym = symbols.find(s => s.id === d.symbolId)
    const isLow = d.confidence < threshold / 100
    const color = d.color || sym?.color || '#3B82F6'
    const shape = d.shape || sym?.shape || 'rect'
    const fill = color + '28'
    const stroke = isLow ? '#F59E0B' : color
    const cx = d.x + d.w / 2
    const cy = d.y + d.h / 2
    const r = Math.min(d.w, d.h) / 2

    return (
      <g>
        {isFocused && <rect x={d.x - 8} y={d.y - 8} width={d.w + 16} height={d.h + 16} fill="none" stroke="#6366F1" strokeWidth={4} strokeDasharray="8 4" rx={6} />}
        {shape === 'rect' && <rect x={d.x} y={d.y} width={d.w} height={d.h} fill={fill} stroke={stroke} strokeWidth={2} rx={3} />}
        {shape === 'circle' && <circle cx={cx} cy={cy} r={r} fill={fill} stroke={stroke} strokeWidth={2} />}
        {shape === 'diamond' && <polygon points={`${cx},${d.y} ${d.x + d.w},${cy} ${cx},${d.y + d.h} ${d.x},${cy}`} fill={fill} stroke={stroke} strokeWidth={2} />}
        <rect x={d.x} y={d.y - 18} width={36} height={14} fill={stroke} rx={3} opacity={0.92} />
        <text x={d.x + 4} y={d.y - 7} fontSize={11} fill="white" fontWeight="600">{Math.round(d.confidence * 100)}%</text>
        {isLow && <text x={cx} y={cy + 5} fontSize={12} fill="#B45309" textAnchor="middle" fontWeight="700">?</text>}
      </g>
    )
  }

  // ── styles ──
  const s = {
    app: { display: 'flex', flexDirection: 'column', height: '100vh', background: T.bg, color: T.text, fontFamily: 'system-ui, sans-serif' },
    header: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', background: T.header, borderBottom: `0.5px solid ${T.border}`, flexShrink: 0, height: 44 },
    sidebar: { background: T.sidebar, borderColor: T.border },
    btn: { background: T.btn, border: `0.5px solid ${T.border}`, color: T.textSub, borderRadius: 6, padding: '5px 11px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 },
    toolBtn: (active) => ({ display: 'flex', alignItems: 'center', gap: 7, padding: '6px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer', marginBottom: 2, background: active ? T.active : 'transparent', color: active ? T.activeText : T.textSub, border: `0.5px solid ${active ? T.activeBorder : 'transparent'}`, fontWeight: active ? 500 : 400 }),
    tab: (active) => ({ padding: '4px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer', border: `0.5px solid ${active ? T.border : 'transparent'}`, background: active ? T.active : 'transparent', color: active ? T.activeText : T.textSub, fontWeight: active ? 500 : 400 }),
    secLabel: { fontSize: 10, color: T.textHint, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginBottom: 6 },
    card: { padding: '10px 10px', borderRadius: 8, border: `0.5px solid ${T.border}`, background: T.bg, marginBottom: 7 },
    input: { fontSize: 12, padding: '4px 8px', border: `0.5px solid ${T.border}`, borderRadius: 6, background: T.sidebar, color: T.text, width: '100%' },
  }

  return (
    <div style={s.app}>
      {/* ===== HEADER ===== */}
      <header style={s.header}>
        <span style={{ fontWeight: 500, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          PDF Takeoff
        </span>

        <select value={activeProjectId || ''} onChange={e => setActiveProjectId(Number(e.target.value) || null)}
          style={{ ...s.input, width: 140, padding: '3px 8px' }}>
          <option value="">— โปรเจกต์ —</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={() => setShowProjectModal(true)} style={s.btn}>+ ใหม่</button>
        {activeProjectId && <button onClick={saveProject} style={{ ...s.btn, background: '#059669', color: '#fff', border: 'none' }}>บันทึก</button>}

        <nav style={{ display: 'flex', gap: 3, marginLeft: 8 }}>
          {[['canvas','แบบแปลน'],['review',`ตรวจสอบ${pendingDetections.length > 0 ? ` (${pendingDetections.length})` : ''}`],['summary','สรุปปริมาณ']].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} style={s.tab(tab === t)}>{label}</button>
          ))}
        </nav>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Theme */}
          <div style={{ display: 'flex', gap: 3 }}>
            {[['light','☀'],['dark','🌙'],['hc','◑']].map(([name, icon]) => (
              <button key={name} onClick={() => setThemeName(name)}
                style={{ ...s.btn, padding: '4px 8px', background: themeName === name ? T.active : T.btn, color: themeName === name ? T.activeText : T.textSub }}>
                {icon}
              </button>
            ))}
          </div>
          {pdfFileName && <span style={{ fontSize: 11, color: T.textHint, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pdfFileName}</span>}
          <button onClick={() => fileInputRef.current?.click()} style={s.btn}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            อัปโหลด PDF
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={handleFileUpload} />
        </div>
      </header>

      {/* ===== BODY ===== */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden', minHeight: 0 }}>

        {/* ===== LEFT TOOLBAR ===== */}
        <aside style={{ width: 200, ...s.sidebar, borderRight: `0.5px solid ${T.border}`, padding: 12, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', flexShrink: 0 }}>
          <div>
            <div style={s.secLabel}>เครื่องมือ</div>
            {[
              { id: 'select', label: 'เลือก / ดู', sub: '' },
              { id: 'crop', label: 'ครอบสัญลักษณ์', sub: '' },
              { id: 'pan', label: 'ลากเลื่อน', sub: 'Space' },
            ].map(t => (
              <button key={t.id} onClick={() => setTool(t.id)} style={s.toolBtn(tool === t.id)}>
                <span style={{ fontSize: 14, width: 18, textAlign: 'center' }}>
                  {t.id === 'select' ? '↖' : t.id === 'crop' ? '⊡' : '✥'}
                </span>
                {t.label}
                {t.sub && <span style={{ fontSize: 9, color: T.textHint, marginLeft: 'auto', background: T.btn, borderRadius: 3, padding: '1px 4px' }}>{t.sub}</span>}
              </button>
            ))}
          </div>

          {/* Zoom */}
          <div style={{ display: 'flex', gap: 4 }}>
            <button onClick={() => setZoom(z => Math.min(z + 0.25, 6))} style={{ ...s.btn, flex: 1, justifyContent: 'center', fontSize: 16, padding: '4px 0' }}>+</button>
            <button onClick={fitScreen} style={{ ...s.btn, flex: 2, justifyContent: 'center', fontSize: 11 }}>{Math.round(zoom * 100)}% F</button>
            <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))} style={{ ...s.btn, flex: 1, justifyContent: 'center', fontSize: 16, padding: '4px 0' }}>−</button>
          </div>
          <div style={{ fontSize: 10, color: T.textHint }}>Ctrl+scroll เพื่อ zoom</div>

          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => setPageNum(p => Math.max(1, p - 1))} style={{ ...s.btn, padding: '4px 8px' }} disabled={pageNum <= 1}>‹</button>
              <span style={{ flex: 1, textAlign: 'center', fontSize: 11, color: T.textSub }}>หน้า {pageNum}/{totalPages}</span>
              <button onClick={() => setPageNum(p => Math.min(totalPages, p + 1))} style={{ ...s.btn, padding: '4px 8px' }} disabled={pageNum >= totalPages}>›</button>
            </div>
          )}

          <div style={{ borderTop: `0.5px solid ${T.border}`, paddingTop: 10 }}>
            <div style={s.secLabel}>ความแม่นยำขั้นต่ำ</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="range" min={0} max={100} step={1} value={threshold} onChange={e => setThreshold(+e.target.value)} style={{ flex: 1 }} />
              <span style={{ fontSize: 11, fontWeight: 500, minWidth: 30, textAlign: 'right', color: T.text }}>{threshold}%</span>
            </div>
            <div style={{ fontSize: 10, color: T.textHint, marginTop: 3 }}>ต่ำกว่านี้ = สีเหลือง</div>
          </div>

          {/* Scan mode */}
          <div>
            <div style={s.secLabel}>โหมดสแกน</div>
            <div style={{ display: 'flex', gap: 4 }}>
              {[['replace','สแกนใหม่'],['append','เพิ่มเติม']].map(([m, label]) => (
                <button key={m} onClick={() => setScanMode(m)}
                  style={{ ...s.btn, flex: 1, justifyContent: 'center', fontSize: 11, background: scanMode === m ? T.active : T.btn, color: scanMode === m ? T.activeText : T.textSub }}>
                  {label}
                </button>
              ))}
            </div>
            {scanMode === 'append' && <div style={{ fontSize: 10, color: '#059669', marginTop: 3 }}>✓ Approved เดิมจะถูกเก็บไว้</div>}
          </div>

          <button onClick={() => runScan(scanMode)}
            disabled={scanning || !cvReady || !pdfDoc || symbols.length === 0}
            style={{ padding: '8px 0', fontSize: 12, fontWeight: 500, borderRadius: 8, background: scanning || !cvReady || !pdfDoc || symbols.length === 0 ? T.btn : '#1D4ED8', color: scanning || !cvReady || !pdfDoc || symbols.length === 0 ? T.textHint : '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {cvLoading ? '⏳ โหลด OpenCV...' : scanning ? `⏳ ${scanProgress}%` : '▶ Run Scan'}
          </button>
          {!pdfDoc && <div style={{ fontSize: 11, color: T.textHint, textAlign: 'center' }}>อัปโหลด PDF ก่อน</div>}

          {/* Shortcuts hint */}
          <div style={{ borderTop: `0.5px solid ${T.border}`, paddingTop: 10 }}>
            <div style={s.secLabel}>Shortcuts</div>
            {[['A','Approve รายการแรก'],['D','Reject รายการแรก'],['F','Fit to screen'],['Space','Pan ชั่วคราว']].map(([k, desc]) => (
              <div key={k} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 4 }}>
                <span style={{ fontSize: 10, background: T.btn, border: `0.5px solid ${T.border}`, borderRadius: 3, padding: '1px 5px', fontFamily: 'monospace', color: T.text, minWidth: 20, textAlign: 'center' }}>{k}</span>
                <span style={{ fontSize: 10, color: T.textHint }}>{desc}</span>
              </div>
            ))}
          </div>

          {/* Symbols */}
          {symbols.length > 0 && (
            <div style={{ borderTop: `0.5px solid ${T.border}`, paddingTop: 10 }}>
              <div style={s.secLabel}>สัญลักษณ์ที่บันทึก</div>
              {symbols.map(sym => (
                <div key={sym.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 4px', borderRadius: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: sym.shape === 'circle' ? '50%' : sym.shape === 'diamond' ? '0px' : '2px', background: sym.color, flexShrink: 0, transform: sym.shape === 'diamond' ? 'rotate(45deg)' : 'none' }} />
                  {sym.templateDataUrl && <img src={sym.templateDataUrl} alt="" style={{ width: 24, height: 24, objectFit: 'contain', border: `0.5px solid ${T.border}`, borderRadius: 4, background: 'white' }} />}
                  <span style={{ fontSize: 11, flex: 1, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sym.name}</span>
                  <span style={{ fontSize: 10, background: T.btn, borderRadius: 4, padding: '1px 5px', color: T.textSub }}>{approvedCounts[sym.id] || 0}</span>
                </div>
              ))}
            </div>
          )}

          {/* Autosave status */}
          {lastSaved && (
            <div style={{ fontSize: 10, color: '#059669', display: 'flex', alignItems: 'center', gap: 4 }}>
              ✓ บันทึกอัตโนมัติ {lastSaved.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
            </div>
          )}
        </aside>

        {/* ===== CENTER — always rendered, hidden via display ===== */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

          {/* Canvas tab — always in DOM, visibility toggled */}
          <div
            ref={containerRef}
            style={{ flex: 1, overflow: 'hidden', position: 'relative', background: T.canvas, cursor: cursorStyle, display: tab === 'canvas' ? 'block' : 'none' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => { setIsPanning(false); if (isDrawing) { setIsDrawing(false); setDrawBox(null) } }}
          >
            {!pdfDoc && (
              <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, color: T.textHint }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <p style={{ fontSize: 14 }}>อัปโหลด PDF เพื่อเริ่มต้น</p>
                <button onClick={() => fileInputRef.current?.click()} style={{ ...s.btn, background: '#1D4ED8', color: '#fff', border: 'none', padding: '8px 20px', fontSize: 13 }}>อัปโหลด PDF</button>
              </div>
            )}

            <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', willChange: 'transform', display: 'inline-block', position: 'relative' }}>
              <canvas ref={pdfCanvasRef} style={{ display: 'block', imageRendering: 'auto' }} />

              {pdfCanvasRef.current && (
                <svg
                  style={{ position: 'absolute', top: 0, left: 0, width: pdfCanvasRef.current.style.width, height: pdfCanvasRef.current.style.height, pointerEvents: 'none' }}
                  viewBox={`0 0 ${pdfCanvasRef.current.width} ${pdfCanvasRef.current.height}`}
                >
                  {currentPageDetections.map(d => (
                    <DetectionShape key={d.id} d={d} isFocused={itemPopup?.detId === d.id} />
                  ))}
                  {drawBox && drawBox.w > 2 && (
                    <rect x={drawBox.x} y={drawBox.y} width={drawBox.w} height={drawBox.h} fill="rgba(99,102,241,0.07)" stroke="#6366F1" strokeWidth={2} strokeDasharray="8 4" rx={3} />
                  )}
                </svg>
              )}
            </div>

            {rendering && (
              <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,0.55)', color: '#fff', fontSize: 12, padding: '5px 14px', borderRadius: 20 }}>render...</div>
            )}

            {/* Item popup */}
            {itemPopup && (
              <div style={{
                position: 'absolute',
                left: Math.min(itemPopup.screenX + 12, (containerRef.current?.clientWidth || 600) - 220),
                top: Math.min(itemPopup.screenY - 10, (containerRef.current?.clientHeight || 400) - 260),
                width: 210, background: T.sidebar, border: `0.5px solid ${T.border}`, borderRadius: 10,
                padding: 14, zIndex: 30, boxShadow: '0 4px 24px rgba(0,0,0,0.15)'
              }}>
                {(() => {
                  const d = detectionsRef.current.find(x => x.id === itemPopup.detId)
                  if (!d) return null
                  const sym = symbols.find(s => s.id === d.symbolId)
                  return (
                    <>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                        <div style={{ width: 10, height: 10, borderRadius: 2, background: d.color || sym?.color }} />
                        <span style={{ fontSize: 13, fontWeight: 500, flex: 1 }}>{sym?.name}</span>
                        <button onClick={() => setItemPopup(null)} style={{ fontSize: 16, background: 'none', border: 'none', cursor: 'pointer', color: T.textHint, lineHeight: 1 }}>×</button>
                      </div>

                      <div style={{ fontSize: 11, color: T.textHint, marginBottom: 10 }}>
                        ความมั่นใจ {Math.round(d.confidence * 100)}% · หน้า {d.page}
                      </div>

                      {/* Shape picker */}
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 10, color: T.textHint, marginBottom: 4 }}>รูปทรง</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {SHAPES.map(sh => (
                            <button key={sh} onClick={() => updateDetectionStyle(itemPopup.detId, { shape: sh })}
                              style={{ flex: 1, padding: '4px 0', fontSize: 11, border: `0.5px solid ${(d.shape || 'rect') === sh ? T.activeText : T.border}`, borderRadius: 5, background: (d.shape || 'rect') === sh ? T.active : T.btn, color: (d.shape || 'rect') === sh ? T.activeText : T.textSub, cursor: 'pointer' }}>
                              {sh === 'rect' ? '▭' : sh === 'circle' ? '○' : '◇'}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Color picker */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 10, color: T.textHint, marginBottom: 4 }}>สี</div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {SYMBOL_COLORS.map(c => (
                            <div key={c} onClick={() => updateDetectionStyle(itemPopup.detId, { color: c })}
                              style={{ width: 20, height: 20, borderRadius: 4, background: c, cursor: 'pointer', outline: (d.color || sym?.color) === c ? '2px solid #1D4ED8' : '2px solid transparent', outlineOffset: 1 }} />
                          ))}
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {d.status === 'pending' ? (
                          <div style={{ display: 'flex', gap: 6 }}>
                            <button onClick={() => approveDetection(itemPopup.detId)} style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 500, background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>✓ Approve</button>
                            <button onClick={() => rejectDetection(itemPopup.detId)} style={{ flex: 1, padding: '7px 0', fontSize: 12, fontWeight: 500, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>✕ Reject</button>
                          </div>
                        ) : (
                          <>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '5px 0', background: '#DCFCE7', borderRadius: 6 }}>
                              <span style={{ fontSize: 12, color: '#059669', fontWeight: 500 }}>✓ ยืนยันแล้ว</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={() => unapproveDetection(itemPopup.detId)} style={{ flex: 1, padding: '6px 0', fontSize: 11, background: '#F59E0B', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>↩ ยกเลิก</button>
                              <button onClick={() => rejectDetection(itemPopup.detId)} style={{ flex: 1, padding: '6px 0', fontSize: 11, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>✕ ลบ</button>
                            </div>
                          </>
                        )}
                      </div>
                    </>
                  )
                })()}
              </div>
            )}
          </div>

          {/* Review tab */}
          {tab === 'review' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              <div style={{ maxWidth: 760, margin: '0 auto' }}>
                <p style={{ fontSize: 13, color: T.textSub, marginBottom: 16 }}>
                  รายการที่ความมั่นใจต่ำกว่า {threshold}% — กด <kbd style={{ background: T.btn, borderRadius: 3, padding: '1px 5px', fontSize: 11 }}>A</kbd> Approve <kbd style={{ background: T.btn, borderRadius: 3, padding: '1px 5px', fontSize: 11 }}>D</kbd> Reject
                </p>
                {detections.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '60px 0', color: T.textHint }}>
                    <div style={{ fontSize: 40, marginBottom: 8 }}>📋</div>
                    <p style={{ fontSize: 14 }}>ยังไม่มีข้อมูล กด Run Scan ก่อน</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {/* Pending */}
                    {pendingDetections.length > 0 && (
                      <>
                        <p style={{ fontSize: 11, color: T.textHint, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>รอตรวจสอบ ({pendingDetections.length})</p>
                        {pendingDetections.map(d => {
                          const sym = symbols.find(s => s.id === d.symbolId)
                          return (
                            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: T.sidebar, borderRadius: 10, border: `0.5px solid #F59E0B` }}>
                              <div style={{ width: 9, height: 9, borderRadius: 2, background: sym?.color, flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{sym?.name || '?'}</p>
                                <p style={{ fontSize: 11, color: T.textHint }}>หน้า {d.page} · ({Math.round(d.x / SCALE)}, {Math.round(d.y / SCALE)})</p>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                                <div style={{ width: 44, height: 4, background: T.btn, borderRadius: 3, overflow: 'hidden' }}>
                                  <div style={{ height: '100%', width: `${Math.round(d.confidence * 100)}%`, background: '#F59E0B', borderRadius: 3 }} />
                                </div>
                                <span style={{ fontSize: 11, color: '#B45309', minWidth: 26 }}>{Math.round(d.confidence * 100)}%</span>
                              </div>
                              <button onClick={() => focusDetection(d)} style={{ ...s.btn, padding: '4px 8px', fontSize: 11, flexShrink: 0 }}>ดู</button>
                              <button onClick={() => approveDetection(d.id)} style={{ padding: '5px 11px', fontSize: 12, fontWeight: 500, background: '#059669', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }}>✓</button>
                              <button onClick={() => rejectDetection(d.id)} style={{ padding: '5px 11px', fontSize: 12, fontWeight: 500, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                            </div>
                          )
                        })}
                      </>
                    )}
                    {/* Approved */}
                    {approvedDetections.length > 0 && (
                      <>
                        <p style={{ fontSize: 11, color: T.textHint, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 10, marginBottom: 2 }}>ยืนยันแล้ว ({approvedDetections.length})</p>
                        {approvedDetections.map(d => {
                          const sym = symbols.find(s => s.id === d.symbolId)
                          return (
                            <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: T.sidebar, borderRadius: 10, border: `0.5px solid ${T.border}` }}>
                              <div style={{ width: 9, height: 9, borderRadius: 2, background: sym?.color, flexShrink: 0 }} />
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <p style={{ fontSize: 13, fontWeight: 500, color: T.text }}>{sym?.name || '?'}</p>
                                <p style={{ fontSize: 11, color: T.textHint }}>หน้า {d.page} · ({Math.round(d.x / SCALE)}, {Math.round(d.y / SCALE)})</p>
                              </div>
                              <span style={{ fontSize: 11, color: '#059669', flexShrink: 0 }}>✓ ยืนยัน</span>
                              <button onClick={() => focusDetection(d)} style={{ ...s.btn, padding: '4px 8px', fontSize: 11, flexShrink: 0 }}>ดู</button>
                              <button onClick={() => unapproveDetection(d.id)} style={{ padding: '5px 10px', fontSize: 11, background: '#F59E0B', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }}>↩</button>
                              <button onClick={() => rejectDetection(d.id)} style={{ padding: '5px 10px', fontSize: 11, background: '#DC2626', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', flexShrink: 0 }}>✕</button>
                            </div>
                          )
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Summary tab */}
          {tab === 'summary' && (
            <div style={{ flex: 1, overflowY: 'auto', padding: 20 }}>
              <div style={{ maxWidth: 860, margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <p style={{ fontSize: 13, color: T.textSub }}>ดับเบิ้ลคลิกที่เซลล์เพื่อแก้ไข</p>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setSummaryRows(prev => [...prev, { id: Date.now(), name: 'อุปกรณ์ใหม่', color: SYMBOL_COLORS[prev.length % SYMBOL_COLORS.length], qty: 0, wastage: 5, unitCost: 0, editingName: true, editingQty: false }])}
                      style={s.btn}>+ เพิ่มแถว</button>
                    <button onClick={exportExcel} style={{ ...s.btn, background: '#059669', color: '#fff', border: 'none' }}>
                      ↓ Export Excel
                    </button>
                  </div>
                </div>
                <div style={{ background: T.sidebar, borderRadius: 12, border: `0.5px solid ${T.border}`, overflow: 'hidden' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: T.bg }}>
                        {['', 'ชื่ออุปกรณ์', 'จำนวนนับ', 'เผื่อ (%)', 'ราคา/หน่วย (฿)', 'ราคารวม (฿)', ''].map((h, i) => (
                          <th key={i} style={{ padding: '9px 12px', textAlign: 'left', fontSize: 11, fontWeight: 500, color: T.textHint, borderBottom: `0.5px solid ${T.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {summaryRows.map(row => {
                        const net = Math.round(row.qty * (1 + row.wastage / 100))
                        const total = net * row.unitCost
                        return (
                          <tr key={row.id} style={{ borderBottom: `0.5px solid ${T.border}` }}>
                            <td style={{ padding: '9px 12px', width: 20 }}><div style={{ width: 12, height: 12, borderRadius: 3, background: row.color }} /></td>
                            <td style={{ padding: '9px 12px' }}>
                              {row.editingName
                                ? <input autoFocus defaultValue={row.name} style={{ ...s.input, width: '100%' }}
                                    onBlur={e => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, name: e.target.value, editingName: false } : r))}
                                    onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
                                : <span onDoubleClick={() => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, editingName: true } : r))} style={{ cursor: 'text', display: 'block', color: T.text }}>{row.name}</span>}
                            </td>
                            <td style={{ padding: '9px 12px' }}>
                              {row.editingQty
                                ? <input type="number" autoFocus defaultValue={row.qty} style={{ ...s.input, width: 70 }}
                                    onBlur={e => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, qty: +e.target.value || 0, editingQty: false } : r))}
                                    onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
                                : <span onDoubleClick={() => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, editingQty: true } : r))} style={{ cursor: 'text', fontWeight: 500, color: T.text }}>{row.qty} <span style={{ color: T.textHint, fontSize: 11 }}>→ {net}</span></span>}
                            </td>
                            <td style={{ padding: '9px 12px' }}>
                              <input type="number" value={row.wastage} min={0} max={100} step={1} style={{ ...s.input, width: 60 }}
                                onChange={e => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, wastage: +e.target.value } : r))} />
                            </td>
                            <td style={{ padding: '9px 12px' }}>
                              <input type="number" value={row.unitCost} min={0} step={1} style={{ ...s.input, width: 100 }}
                                onChange={e => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, unitCost: +e.target.value } : r))} />
                            </td>
                            <td style={{ padding: '9px 12px', fontWeight: 500, color: T.text }}>{total > 0 ? '฿' + total.toLocaleString() : <span style={{ color: T.textHint }}>—</span>}</td>
                            <td style={{ padding: '9px 12px' }}>
                              <button onClick={() => setSummaryRows(prev => prev.filter(r => r.id !== row.id))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: T.textHint, fontSize: 14 }}>✕</button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: T.bg, borderTop: `0.5px solid ${T.border}` }}>
                        <td colSpan={5} style={{ padding: '10px 12px', fontSize: 13, fontWeight: 500, color: T.textSub }}>ราคารวมทั้งโครงการ</td>
                        <td style={{ padding: '10px 12px', fontSize: 15, fontWeight: 500, color: T.text }}>
                          {'฿' + summaryRows.reduce((a, r) => a + Math.round(r.qty * (1 + r.wastage / 100)) * r.unitCost, 0).toLocaleString()}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ===== RIGHT SIDEBAR ===== */}
        <aside style={{ width: 188, ...s.sidebar, borderLeft: `0.5px solid ${T.border}`, padding: 12, overflowY: 'auto', flexShrink: 0 }}>
          <div style={s.secLabel}>ยอดรวมหน้านี้</div>
          {symbols.length === 0 ? <p style={{ fontSize: 11, color: T.textHint }}>ยังไม่มีสัญลักษณ์</p> : (
            symbols.map(sym => {
              const pageApproved = currentPageDetections.filter(d => d.symbolId === sym.id && d.status === 'approved').length
              const pagePending = currentPageDetections.filter(d => d.symbolId === sym.id && d.status === 'pending').length
              return (
                <div key={sym.id} style={s.card}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                    <div style={{ width: 9, height: 9, borderRadius: 2, background: sym.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 500, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sym.name}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div><div style={{ fontSize: 10, color: T.textHint }}>ยืนยัน</div><div style={{ fontSize: 20, fontWeight: 500, lineHeight: 1, color: T.text }}>{pageApproved}</div></div>
                    {pagePending > 0 && <div><div style={{ fontSize: 10, color: '#B45309' }}>รอตรวจ</div><div style={{ fontSize: 20, fontWeight: 500, lineHeight: 1, color: '#B45309' }}>{pagePending}</div></div>}
                  </div>
                </div>
              )
            })
          )}
          {detections.length > 0 && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `0.5px solid ${T.border}` }}>
              <div style={s.secLabel}>รวมทุกหน้า</div>
              <div style={{ fontSize: 26, fontWeight: 500, color: T.text }}>{approvedDetections.length}</div>
              {pendingDetections.length > 0 && <div style={{ fontSize: 11, color: '#B45309', marginTop: 2 }}>รอตรวจ {pendingDetections.length}</div>}
            </div>
          )}
        </aside>
      </div>

      {/* ===== TOAST ===== */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#1E293B', color: '#F1F5F9', padding: '10px 18px', borderRadius: 10, fontSize: 13, display: 'flex', alignItems: 'center', gap: 12, zIndex: 100, boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}>
          {toast.msg}
          {toast.action && <button onClick={() => { toast.action(); setToast(null) }} style={{ background: '#3B82F6', color: '#fff', border: 'none', borderRadius: 6, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}>ไปตรวจสอบ →</button>}
          <button onClick={() => setToast(null)} style={{ background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* ===== POPUP: เพิ่ม detection ด้วยมือ ===== */}
      {showManualPopup && manualBox && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowManualPopup(false); setDrawBox(null) } }}>
          <div style={{ background: T.sidebar, borderRadius: 14, padding: 24, width: 300, border: `0.5px solid ${T.border}` }}>
            <p style={{ fontWeight: 500, fontSize: 15, marginBottom: 4, color: T.text }}>เพิ่มตำแหน่งด้วยมือ</p>
            <p style={{ fontSize: 12, color: T.textHint, marginBottom: 16 }}>เลือกสัญลักษณ์ที่ตรงกับจุดนี้</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
              {symbols.map(sym => (
                <button key={sym.id} onClick={() => setManualSymbolId(sym.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', borderRadius: 8, border: `0.5px solid ${manualSymbolId === sym.id ? T.activeText : T.border}`, background: manualSymbolId === sym.id ? T.active : T.btn, cursor: 'pointer' }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: sym.color, flexShrink: 0 }} />
                  {sym.templateDataUrl && <img src={sym.templateDataUrl} alt="" style={{ width: 24, height: 24, objectFit: 'contain', border: `0.5px solid ${T.border}`, borderRadius: 4, background: 'white' }} />}
                  <span style={{ fontSize: 13, color: T.text }}>{sym.name}</span>
                  {manualSymbolId === sym.id && <span style={{ marginLeft: 'auto', color: T.activeText, fontSize: 14 }}>✓</span>}
                </button>
              ))}
              <button onClick={() => { setShowManualPopup(false); setShowNamePopup(true); setNewDeviceName(''); setNewDeviceColor(SYMBOL_COLORS[symbols.length % SYMBOL_COLORS.length]); setNewDeviceShape('rect') }}
                style={{ padding: '7px 12px', borderRadius: 8, border: `0.5px dashed ${T.border}`, background: 'transparent', cursor: 'pointer', fontSize: 12, color: T.textSub }}>
                + สร้างสัญลักษณ์ใหม่
              </button>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setShowManualPopup(false); setDrawBox(null); setManualBox(null) }}
                style={{ flex: 1, padding: '8px 0', fontSize: 13, border: `0.5px solid ${T.border}`, borderRadius: 8, background: T.btn, color: T.textSub, cursor: 'pointer' }}>ยกเลิก</button>
              <button onClick={() => {
                if (!manualSymbolId) return
                const sym = symbols.find(s => s.id === manualSymbolId)
                const newDet = {
                  id: Date.now() + Math.random(),
                  symbolId: manualSymbolId,
                  x: manualBox.x, y: manualBox.y, w: manualBox.w, h: manualBox.h,
                  confidence: 1.0, status: 'approved', page: pageNum,
                  shape: sym?.shape || 'rect', color: sym?.color || '#3B82F6',
                }
                setDetections(prev => {
                  const next = [...prev, newDet]
                  setSummaryRows(sr => sr.map(r => ({ ...r, qty: next.filter(d => d.symbolId === r.id && d.status === 'approved').length })))
                  return next
                })
                setShowManualPopup(false); setDrawBox(null); setManualBox(null)
                showToast(`เพิ่ม ${sym?.name} แล้ว`)
              }} style={{ flex: 2, padding: '8px 0', fontSize: 13, fontWeight: 500, borderRadius: 8, background: manualSymbolId ? '#059669' : T.btn, color: manualSymbolId ? '#fff' : T.textHint, border: 'none', cursor: manualSymbolId ? 'pointer' : 'not-allowed' }}>
                เพิ่ม Detection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== POPUP: ตั้งชื่อสัญลักษณ์ ===== */}
      {showNamePopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget) { setShowNamePopup(false); setDrawBox(null) } }}>
          <div style={{ background: T.sidebar, borderRadius: 14, padding: 24, width: 320, border: `0.5px solid ${T.border}` }}>
            <p style={{ fontWeight: 500, fontSize: 15, marginBottom: 16, color: T.text }}>บันทึกสัญลักษณ์ใหม่</p>

            {pendingBox && pdfCanvasRef.current && (
              <div style={{ marginBottom: 14, display: 'flex', justifyContent: 'center' }}>
                <canvas ref={c => {
                  if (c && pdfCanvasRef.current && pendingBox) {
                    c.width = Math.round(pendingBox.w); c.height = Math.round(pendingBox.h)
                    c.style.maxWidth = '120px'; c.style.maxHeight = '120px'
                    c.getContext('2d').drawImage(pdfCanvasRef.current, Math.round(pendingBox.x), Math.round(pendingBox.y), Math.round(pendingBox.w), Math.round(pendingBox.h), 0, 0, Math.round(pendingBox.w), Math.round(pendingBox.h))
                  }
                }} style={{ border: `0.5px solid ${T.border}`, borderRadius: 6, background: 'white' }} />
              </div>
            )}

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: T.textHint, display: 'block', marginBottom: 4 }}>ชื่ออุปกรณ์</label>
              <input value={newDeviceName} onChange={e => setNewDeviceName(e.target.value)} placeholder="เช่น เต้าเสียบ 2P, Downlight 6W"
                style={{ ...s.input, padding: '8px 10px', borderRadius: 8 }}
                onKeyDown={e => e.key === 'Enter' && handleSaveSymbol()} autoFocus />
            </div>

            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 11, color: T.textHint, display: 'block', marginBottom: 6 }}>รูปทรง</label>
              <div style={{ display: 'flex', gap: 6 }}>
                {SHAPES.map(sh => (
                  <button key={sh} onClick={() => setNewDeviceShape(sh)}
                    style={{ flex: 1, padding: '6px 0', fontSize: 18, border: `0.5px solid ${newDeviceShape === sh ? T.activeText : T.border}`, borderRadius: 7, background: newDeviceShape === sh ? T.active : T.btn, cursor: 'pointer' }}>
                    {sh === 'rect' ? '▭' : sh === 'circle' ? '○' : '◇'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 11, color: T.textHint, display: 'block', marginBottom: 6 }}>สีไฮไลท์</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {SYMBOL_COLORS.map(c => (
                  <div key={c} onClick={() => setNewDeviceColor(c)}
                    style={{ width: 28, height: 28, borderRadius: 6, background: c, cursor: 'pointer', outline: newDeviceColor === c ? '3px solid #1e40af' : '2px solid transparent', outlineOffset: 2 }} />
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setShowNamePopup(false); setDrawBox(null) }} style={{ ...s.btn, flex: 1, justifyContent: 'center', padding: '8px 0' }}>ยกเลิก</button>
              <button onClick={handleSaveSymbol} disabled={!newDeviceName.trim()}
                style={{ flex: 2, padding: '8px 0', fontSize: 13, fontWeight: 500, borderRadius: 8, background: newDeviceName.trim() ? '#1D4ED8' : T.btn, color: newDeviceName.trim() ? '#fff' : T.textHint, border: 'none', cursor: newDeviceName.trim() ? 'pointer' : 'not-allowed' }}>
                บันทึกสัญลักษณ์
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: โปรเจกต์ใหม่ ===== */}
      {showProjectModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}
          onClick={e => { if (e.target === e.currentTarget) setShowProjectModal(false) }}>
          <div style={{ background: T.sidebar, borderRadius: 14, padding: 24, width: 300, border: `0.5px solid ${T.border}` }}>
            <p style={{ fontWeight: 500, fontSize: 15, marginBottom: 16, color: T.text }}>สร้างโปรเจกต์ใหม่</p>
            <input value={newProjectName} onChange={e => setNewProjectName(e.target.value)} placeholder="ชื่อโปรเจกต์ เช่น อาคาร A ชั้น 1"
              style={{ ...s.input, padding: '8px 10px', borderRadius: 8, marginBottom: 16 }}
              onKeyDown={e => e.key === 'Enter' && createProject()} autoFocus />
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setShowProjectModal(false)} style={{ ...s.btn, flex: 1, justifyContent: 'center', padding: '8px 0' }}>ยกเลิก</button>
              <button onClick={createProject} disabled={!newProjectName.trim()}
                style={{ flex: 2, padding: '8px 0', fontSize: 13, fontWeight: 500, borderRadius: 8, background: '#1D4ED8', color: '#fff', border: 'none', cursor: 'pointer' }}>
                สร้าง
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
