// App.jsx — PDF Construction Takeoff
// Stack: React + Vite + Tailwind + PDF.js + OpenCV.js
// เก็บข้อมูล: localStorage | Deploy: Vercel

import { useState, useRef, useEffect, useCallback } from 'react'
import * as PDFJS from 'pdfjs-dist'
import { useOpenCV } from './hooks/useOpenCV'
import * as XLSX from 'xlsx'

// ตั้ง worker path สำหรับ PDF.js
PDFJS.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

// ---- constants ----
const SCALE = 2.0          // render PDF ที่ 2x เพื่อความคมชัด
const SYMBOL_COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#84CC16']
const LS_KEY = 'pdf-takeoff-projects'

// ---- localStorage helpers ----
function loadProjects() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || [] } catch { return [] }
}
function saveProjects(projects) {
  localStorage.setItem(LS_KEY, JSON.stringify(projects))
}

// ---- main component ----
export default function App() {
  // --- project state ---
  const [projects, setProjects] = useState(loadProjects)
  const [activeProjectId, setActiveProjectId] = useState(null)
  const [showProjectModal, setShowProjectModal] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')

  // --- PDF state ---
  const [pdfDoc, setPdfDoc] = useState(null)
  const [pageNum, setPageNum] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [pdfFileName, setPdfFileName] = useState('')
  const [rendering, setRendering] = useState(false)

  // --- canvas / view state ---
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [tool, setTool] = useState('select') // select | crop | pan
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState(null)

  // --- bounding box drawing ---
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState(null)
  const [drawBox, setDrawBox] = useState(null)
  const [showNamePopup, setShowNamePopup] = useState(false)
  const [pendingBox, setPendingBox] = useState(null)
  const [newDeviceName, setNewDeviceName] = useState('')
  const [newDeviceColor, setNewDeviceColor] = useState(SYMBOL_COLORS[0])

  // --- symbols & detections ---
  const [symbols, setSymbols] = useState([])        // { id, name, color, templateCanvas }
  const [detections, setDetections] = useState([])  // { id, symbolId, x, y, w, h, confidence, status, page }
  const [threshold, setThreshold] = useState(60)
  const [scanning, setScanning] = useState(false)
  const [scanProgress, setScanProgress] = useState(0)

  // --- tabs & review ---
  const [tab, setTab] = useState('canvas')
  const [focusedDetection, setFocusedDetection] = useState(null)

  // --- summary table ---
  const [summaryRows, setSummaryRows] = useState([])

  // --- refs ---
  const pdfCanvasRef = useRef(null)    // canvas ที่ render PDF
  const overlayRef = useRef(null)      // SVG overlay วาด bounding box ทับ
  const containerRef = useRef(null)
  const fileInputRef = useRef(null)
  const pdfDocRef = useRef(null)       // เก็บ pdfDoc ไว้ใน ref ด้วยเพื่อใช้ใน scan loop

  const { ready: cvReady, loading: cvLoading, runTemplateMatch, extractRegion } = useOpenCV()

  // --- sync projects to localStorage ---
  useEffect(() => { saveProjects(projects) }, [projects])

  // --- load active project ---
  const activeProject = projects.find(p => p.id === activeProjectId)

  // --- render PDF page ---
  const renderPage = useCallback(async (doc, page, scale) => {
    if (!pdfCanvasRef.current) return
    setRendering(true)
    try {
      const pdfPage = await doc.getPage(page)
      const viewport = pdfPage.getViewport({ scale: scale * SCALE })
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
    if (pdfDoc && pageNum) renderPage(pdfDoc, pageNum, zoom)
  }, [pdfDoc, pageNum, zoom, renderPage])

  // --- load PDF from file ---
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setPdfFileName(file.name)
    const arrayBuffer = await file.arrayBuffer()
    const doc = await PDFJS.getDocument({ data: arrayBuffer }).promise
    setPdfDoc(doc)
    pdfDocRef.current = doc
    setTotalPages(doc.numPages)
    setPageNum(1)
    setPan({ x: 0, y: 0 })
    setZoom(1)
    setDetections([])
  }

  // --- canvas coordinate helper (คำนึง zoom + pan + SCALE) ---
  const getCanvasPos = useCallback((e) => {
    const canvas = pdfCanvasRef.current
    if (!canvas) return { x: 0, y: 0 }
    const rect = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / zoom) * SCALE,
      y: ((e.clientY - rect.top) / zoom) * SCALE,
    }
  }, [zoom])

  // --- mouse events สำหรับ overlay ---
  const handleMouseDown = (e) => {
    if (tool === 'crop') {
      const pos = getCanvasPos(e)
      setIsDrawing(true)
      setDrawStart(pos)
      setDrawBox({ x: pos.x, y: pos.y, w: 0, h: 0 })
    } else if (tool === 'pan') {
      setIsPanning(true)
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
    }
  }

  const handleMouseMove = (e) => {
    if (isDrawing && tool === 'crop') {
      const pos = getCanvasPos(e)
      setDrawBox({
        x: Math.min(pos.x, drawStart.x),
        y: Math.min(pos.y, drawStart.y),
        w: Math.abs(pos.x - drawStart.x),
        h: Math.abs(pos.y - drawStart.y),
      })
    } else if (isPanning && tool === 'pan') {
      setPan({ x: e.clientX - panStart.x, y: e.clientY - panStart.y })
    }
  }

  const handleMouseUp = () => {
    if (isDrawing && drawBox && drawBox.w > 15 && drawBox.h > 15) {
      setIsDrawing(false)
      setPendingBox({ ...drawBox })
      setShowNamePopup(true)
      setNewDeviceName('')
      setNewDeviceColor(SYMBOL_COLORS[symbols.length % SYMBOL_COLORS.length])
    } else {
      setIsDrawing(false)
      setDrawBox(null)
    }
    setIsPanning(false)
  }

  // --- save new symbol ---
  const handleSaveSymbol = () => {
    if (!newDeviceName.trim() || !pendingBox || !pdfCanvasRef.current) return
    const templateCanvas = extractRegion(
      pdfCanvasRef.current,
      pendingBox.x, pendingBox.y, pendingBox.w, pendingBox.h
    )
    const newSym = {
      id: Date.now(),
      name: newDeviceName.trim(),
      color: newDeviceColor,
      templateCanvas,
      templateDataUrl: templateCanvas.toDataURL(), // เก็บ preview
    }
    setSymbols(prev => [...prev, newSym])
    setSummaryRows(prev => [...prev, {
      id: newSym.id, name: newSym.name, color: newSym.color,
      qty: 0, wastage: 5, unitCost: 0,
      editingName: false, editingQty: false
    }])
    setShowNamePopup(false)
    setDrawBox(null)
    setPendingBox(null)
    setTool('select')
  }

  // --- run scan on all pages ---
  const runScan = async () => {
    if (!cvReady || !pdfDoc || symbols.length === 0) return
    setScanning(true)
    setDetections([])
    setScanProgress(0)

    const newDetections = []
    const total = pdfDoc.numPages * symbols.length

    for (let page = 1; page <= pdfDoc.numPages; page++) {
      // render หน้านี้ลง offscreen canvas
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
          newDetections.push({
            id: Date.now() + Math.random(),
            symbolId: sym.id,
            x: m.x, y: m.y, w: m.w, h: m.h,
            confidence: m.confidence,
            status: m.confidence >= threshold / 100 + 0.1 ? 'approved' : 'pending',
            page,
          })
        })
        setScanProgress(Math.round(((page - 1) * symbols.length + si + 1) / total * 100))
        // ให้ React render ได้ระหว่างรัน
        await new Promise(r => setTimeout(r, 0))
      }
    }

    setDetections(newDetections)
    // อัปเดต qty ใน summary
    setSummaryRows(prev => prev.map(r => ({
      ...r,
      qty: newDetections.filter(d => d.symbolId === r.id && d.status === 'approved').length
    })))
    setScanning(false)
  }

  // --- approve / reject ---
  const approveDetection = (id) => {
    setDetections(prev => prev.map(d => d.id === id ? { ...d, status: 'approved' } : d))
    recalcSummary()
  }
  const rejectDetection = (id) => {
    setDetections(prev => prev.filter(d => d.id !== id))
    recalcSummary()
  }
  const recalcSummary = () => {
    setTimeout(() => {
      setDetections(curr => {
        setSummaryRows(prev => prev.map(r => ({
          ...r,
          qty: curr.filter(d => d.symbolId === r.id && d.status === 'approved').length
        })))
        return curr
      })
    }, 50)
  }

  // --- focus detection on canvas ---
  const focusDetection = (det) => {
    setPageNum(det.page)
    setFocusedDetection(det.id)
    setTab('canvas')
    setZoom(2.5)
    const containerW = containerRef.current?.clientWidth || 700
    const containerH = containerRef.current?.clientHeight || 500
    setPan({
      x: containerW / 2 - (det.x / SCALE + det.w / SCALE / 2) * 2.5,
      y: containerH / 2 - (det.y / SCALE + det.h / SCALE / 2) * 2.5,
    })
  }

  // --- export to Excel ---
  const exportExcel = () => {
    const rows = [['ชื่ออุปกรณ์', 'จำนวนนับ', 'เผื่อสูญเสีย (%)', 'จำนวนสุทธิ', 'ราคา/หน่วย (฿)', 'ราคารวม (฿)']]
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

  // --- save / load project ---
  const saveProject = () => {
    if (!activeProjectId) return
    setProjects(prev => prev.map(p => p.id === activeProjectId
      ? { ...p, symbols: symbols.map(s => ({ ...s, templateCanvas: undefined })), detections, summaryRows, pdfFileName, pageNum }
      : p
    ))
  }

  const createProject = () => {
    if (!newProjectName.trim()) return
    const p = { id: Date.now(), name: newProjectName.trim(), symbols: [], detections: [], summaryRows: [], pdfFileName: '', pageNum: 1 }
    setProjects(prev => [...prev, p])
    setActiveProjectId(p.id)
    setNewProjectName('')
    setShowProjectModal(false)
    setSymbols([])
    setDetections([])
    setSummaryRows([])
  }

  // ---- computed values ----
  const approvedDetections = detections.filter(d => d.status === 'approved')
  const pendingDetections = detections.filter(d => d.status === 'pending')
  const currentPageDetections = detections.filter(d => d.page === pageNum)

  const approvedCounts = {}
  approvedDetections.forEach(d => {
    approvedCounts[d.symbolId] = (approvedCounts[d.symbolId] || 0) + 1
  })

  // ---- render ----
  return (
    <div className="flex flex-col h-screen bg-slate-100 text-slate-800 select-none">

      {/* ===== HEADER ===== */}
      <header className="flex items-center gap-3 px-4 py-2 bg-white border-b border-slate-200 shrink-0">
        <span className="font-semibold text-sm text-slate-700 flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-blue-600"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          PDF Takeoff
        </span>

        {/* Project selector */}
        <div className="flex items-center gap-2 ml-2">
          <select
            value={activeProjectId || ''}
            onChange={e => setActiveProjectId(Number(e.target.value) || null)}
            className="text-xs border border-slate-200 rounded px-2 py-1 bg-white text-slate-600 max-w-40"
          >
            <option value="">— เลือกโปรเจกต์ —</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={() => setShowProjectModal(true)} className="text-xs px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 text-slate-500">+ ใหม่</button>
          {activeProjectId && (
            <button onClick={saveProject} className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700">บันทึก</button>
          )}
        </div>

        {/* Tabs */}
        <nav className="flex gap-1 ml-4">
          {[['canvas','แบบแปลน'],['review',`ตรวจสอบ${pendingDetections.length > 0 ? ` (${pendingDetections.length})` : ''}`],['summary','สรุปปริมาณ']].map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1 text-xs rounded transition-colors ${tab === t ? 'bg-slate-100 text-slate-800 font-medium border border-slate-200' : 'text-slate-500 hover:text-slate-700'}`}>
              {label}
            </button>
          ))}
        </nav>

        {/* Upload */}
        <div className="ml-auto flex items-center gap-2">
          {pdfFileName && <span className="text-xs text-slate-400 max-w-32 truncate">{pdfFileName}</span>}
          <button onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 border border-slate-200 rounded hover:bg-slate-50 text-slate-600">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            อัปโหลด PDF
          </button>
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileUpload} />
        </div>
      </header>

      {/* ===== CANVAS TAB ===== */}
      {tab === 'canvas' && (
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* LEFT TOOLBAR */}
          <aside className="w-52 bg-white border-r border-slate-200 flex flex-col gap-3 p-3 overflow-y-auto shrink-0 text-sm">

            {/* Tools */}
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">เครื่องมือ</p>
              {[
                { id: 'select', label: 'เลือก / ดู', icon: '↖' },
                { id: 'crop', label: 'ครอบสัญลักษณ์', icon: '⊡' },
                { id: 'pan', label: 'ลากเลื่อนแบบ', icon: '✥' },
              ].map(t => (
                <button key={t.id} onClick={() => setTool(t.id)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs mb-0.5 transition-colors ${tool === t.id ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-500 hover:bg-slate-50'}`}>
                  <span className="w-5 text-center font-mono">{t.icon}</span>{t.label}
                </button>
              ))}
            </div>

            {/* Zoom */}
            <div className="flex gap-1">
              <button onClick={() => setZoom(z => Math.min(z + 0.25, 5))} className="flex-1 py-1 text-base border border-slate-200 rounded hover:bg-slate-50">+</button>
              <button onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }) }} className="flex-2 py-1 px-2 text-xs border border-slate-200 rounded hover:bg-slate-50 text-slate-500 min-w-12 text-center">{Math.round(zoom * 100)}%</button>
              <button onClick={() => setZoom(z => Math.max(z - 0.25, 0.25))} className="flex-1 py-1 text-base border border-slate-200 rounded hover:bg-slate-50">−</button>
            </div>

            {/* Page */}
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                <button onClick={() => setPageNum(p => Math.max(1, p - 1))} className="px-2 py-1 border border-slate-200 rounded text-xs hover:bg-slate-50" disabled={pageNum <= 1}>‹</button>
                <span className="text-xs text-slate-500 flex-1 text-center">หน้า {pageNum}/{totalPages}</span>
                <button onClick={() => setPageNum(p => Math.min(totalPages, p + 1))} className="px-2 py-1 border border-slate-200 rounded text-xs hover:bg-slate-50" disabled={pageNum >= totalPages}>›</button>
              </div>
            )}

            {/* Threshold */}
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">ความแม่นยำขั้นต่ำ</p>
              <div className="flex items-center gap-2">
                <input type="range" min={0} max={100} step={1} value={threshold} onChange={e => setThreshold(+e.target.value)} className="flex-1 h-1.5" />
                <span className="text-xs font-medium text-slate-600 w-9 text-right">{threshold}%</span>
              </div>
              <p className="text-xs text-slate-400 mt-1">ต่ำกว่านี้ = สีเหลือง (ต้องตรวจ)</p>
            </div>

            {/* Run Scan */}
            <button onClick={runScan}
              disabled={scanning || !cvReady || !pdfDoc || symbols.length === 0}
              className={`py-2 px-3 rounded text-xs font-medium flex items-center justify-center gap-2 transition-colors ${
                scanning ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : !cvReady ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : !pdfDoc || symbols.length === 0 ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 cursor-pointer'
              }`}>
              {cvLoading ? '⏳ โหลด OpenCV...' : scanning ? `⏳ สแกน ${scanProgress}%` : !cvReady ? '⏳ รอ OpenCV...' : '▶ Run Scan'}
            </button>
            {!pdfDoc && <p className="text-xs text-slate-400 text-center">อัปโหลด PDF ก่อน</p>}
            {pdfDoc && symbols.length === 0 && <p className="text-xs text-slate-400 text-center">ครอบสัญลักษณ์ก่อน</p>}

            {/* Symbols list */}
            {symbols.length > 0 && (
              <div className="border-t border-slate-100 pt-3">
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">สัญลักษณ์ที่บันทึก</p>
                {symbols.map(s => (
                  <div key={s.id} className="flex items-center gap-2 py-1.5 px-1 rounded hover:bg-slate-50">
                    <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: s.color }} />
                    {s.templateDataUrl && (
                      <img src={s.templateDataUrl} alt={s.name} className="w-8 h-8 object-contain border border-slate-200 rounded bg-white" />
                    )}
                    <span className="text-xs text-slate-600 flex-1 truncate">{s.name}</span>
                    <span className="text-xs text-slate-400 bg-slate-100 rounded px-1">{approvedCounts[s.id] || 0}</span>
                  </div>
                ))}
              </div>
            )}
          </aside>

          {/* CENTER CANVAS */}
          <div ref={containerRef}
            className={`flex-1 overflow-hidden relative bg-slate-300 ${tool === 'pan' ? (isPanning ? 'cursor-grabbing' : 'cursor-grab') : tool === 'crop' ? 'cursor-crosshair' : 'cursor-default'}`}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {!pdfDoc && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <p className="text-sm">อัปโหลด PDF เพื่อเริ่มต้น</p>
                <button onClick={() => fileInputRef.current?.click()} className="text-xs px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">อัปโหลด PDF</button>
              </div>
            )}

            <div style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0', willChange: 'transform', display: 'inline-block', position: 'relative' }}>
              {/* PDF Canvas */}
              <canvas ref={pdfCanvasRef} className="block" style={{ imageRendering: 'pixelated' }} />

              {/* SVG Overlay */}
              {pdfCanvasRef.current && (
                <svg
                  style={{
                    position: 'absolute', top: 0, left: 0,
                    width: pdfCanvasRef.current.style.width,
                    height: pdfCanvasRef.current.style.height,
                    pointerEvents: 'none',
                  }}
                  viewBox={`0 0 ${pdfCanvasRef.current.width} ${pdfCanvasRef.current.height}`}
                >
                  {/* Detections on this page */}
                  {currentPageDetections.map(d => {
                    const sym = symbols.find(s => s.id === d.symbolId)
                    if (!sym) return null
                    const isLow = d.confidence < threshold / 100
                    const isFocused = focusedDetection === d.id
                    const color = isLow ? '#F59E0B' : sym.color
                    return (
                      <g key={d.id}>
                        {isFocused && <rect x={d.x - 6} y={d.y - 6} width={d.w + 12} height={d.h + 12} fill="none" stroke="#6366F1" strokeWidth={4} strokeDasharray="8 4" rx={4} />}
                        <rect x={d.x} y={d.y} width={d.w} height={d.h} fill={color + '28'} stroke={color} strokeWidth={2} rx={3} />
                        <rect x={d.x} y={d.y - 18} width={40} height={16} fill={color} rx={3} opacity={0.9} />
                        <text x={d.x + 4} y={d.y - 6} fontSize={12} fill="white" fontWeight="600">
                          {Math.round(d.confidence * 100)}%
                        </text>
                      </g>
                    )
                  })}

                  {/* Drawing box */}
                  {drawBox && drawBox.w > 2 && (
                    <rect x={drawBox.x} y={drawBox.y} width={drawBox.w} height={drawBox.h}
                      fill="rgba(99,102,241,0.08)" stroke="#6366F1" strokeWidth={2} strokeDasharray="8 4" rx={3} />
                  )}
                </svg>
              )}
            </div>

            {rendering && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full">
                กำลัง render...
              </div>
            )}
          </div>

          {/* RIGHT SIDEBAR */}
          <aside className="w-52 bg-white border-l border-slate-200 p-3 overflow-y-auto shrink-0">
            <p className="text-xs text-slate-400 uppercase tracking-wide mb-3">ยอดรวมหน้านี้</p>
            {symbols.length === 0 ? (
              <p className="text-xs text-slate-400">ยังไม่มีสัญลักษณ์</p>
            ) : (
              symbols.map(s => {
                const pageApproved = currentPageDetections.filter(d => d.symbolId === s.id && d.status === 'approved').length
                const pagePending = currentPageDetections.filter(d => d.symbolId === s.id && d.status === 'pending').length
                return (
                  <div key={s.id} className="mb-2 p-2.5 rounded-lg border border-slate-100 bg-slate-50">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <div className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} />
                      <span className="text-xs font-medium text-slate-700 truncate">{s.name}</span>
                    </div>
                    <div className="flex gap-3">
                      <div><p className="text-xs text-slate-400">ยืนยัน</p><p className="text-lg font-semibold leading-none">{pageApproved}</p></div>
                      {pagePending > 0 && <div><p className="text-xs text-amber-600">รอตรวจ</p><p className="text-lg font-semibold leading-none text-amber-600">{pagePending}</p></div>}
                    </div>
                  </div>
                )
              })
            )}

            {detections.length > 0 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-2">รวมทุกหน้า</p>
                <p className="text-2xl font-semibold">{approvedDetections.length}</p>
                {pendingDetections.length > 0 && <p className="text-xs text-amber-600 mt-0.5">รอตรวจ {pendingDetections.length} รายการ</p>}
              </div>
            )}
          </aside>
        </div>
      )}

      {/* ===== REVIEW TAB ===== */}
      {tab === 'review' && (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="max-w-3xl mx-auto">
            <p className="text-sm text-slate-500 mb-4">
              รายการที่ความมั่นใจต่ำกว่า {threshold}% — กด Approve หรือ Reject เพื่ออัปเดตยอดรวม
            </p>

            {pendingDetections.length === 0 ? (
              <div className="text-center py-16 text-slate-400">
                <p className="text-4xl mb-3">✓</p>
                <p className="text-sm">ไม่มีรายการที่ต้องตรวจสอบ</p>
                {detections.length === 0 && <p className="text-xs mt-1">กด Run Scan ก่อนเพื่อสแกน</p>}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {pendingDetections.map(d => {
                  const sym = symbols.find(s => s.id === d.symbolId)
                  return (
                    <div key={d.id} className="flex items-center gap-3 px-4 py-3 bg-white rounded-lg border border-slate-200">
                      <div className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: sym?.color || '#888' }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-700">{sym?.name || '?'}</p>
                        <p className="text-xs text-slate-400">หน้า {d.page} · ตำแหน่ง ({Math.round(d.x / SCALE)}, {Math.round(d.y / SCALE)})</p>
                      </div>
                      {/* Confidence bar */}
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="w-16 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className="h-full bg-amber-400 rounded-full" style={{ width: `${Math.round(d.confidence * 100)}%` }} />
                        </div>
                        <span className="text-xs text-amber-600 w-8">{Math.round(d.confidence * 100)}%</span>
                      </div>
                      <button onClick={() => focusDetection(d)} className="text-xs px-2 py-1 border border-slate-200 rounded hover:bg-slate-50 text-slate-500 shrink-0">ดู</button>
                      <button onClick={() => approveDetection(d.id)} className="text-xs px-3 py-1.5 bg-emerald-500 text-white rounded hover:bg-emerald-600 font-medium shrink-0">✓</button>
                      <button onClick={() => rejectDetection(d.id)} className="text-xs px-3 py-1.5 bg-red-500 text-white rounded hover:bg-red-600 font-medium shrink-0">✕</button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== SUMMARY TAB ===== */}
      {tab === 'summary' && (
        <div className="flex-1 overflow-y-auto p-5">
          <div className="max-w-4xl mx-auto">
            <div className="flex justify-between items-center mb-4">
              <p className="text-sm text-slate-500">ดับเบิ้ลคลิกที่เซลล์เพื่อแก้ไข</p>
              <div className="flex gap-2">
                <button onClick={() => setSummaryRows(prev => [...prev, {
                  id: Date.now(), name: 'อุปกรณ์ใหม่', color: SYMBOL_COLORS[prev.length % SYMBOL_COLORS.length],
                  qty: 0, wastage: 5, unitCost: 0, editingName: true, editingQty: false
                }])} className="text-xs px-3 py-1.5 border border-slate-200 rounded hover:bg-slate-50 text-slate-500 flex items-center gap-1">
                  + เพิ่มแถว
                </button>
                <button onClick={exportExcel} className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 flex items-center gap-1.5">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Export Excel (.xlsx)
                </button>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-xs">
                    {['', 'ชื่ออุปกรณ์', 'จำนวนนับ', 'เผื่อ (%)', 'ราคา/หน่วย (฿)', 'ราคารวม (฿)', ''].map((h, i) => (
                      <th key={i} className="px-3 py-2.5 text-left font-medium border-b border-slate-200">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {summaryRows.map((row) => {
                    const net = Math.round(row.qty * (1 + row.wastage / 100))
                    const total = net * row.unitCost
                    return (
                      <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-3 py-2.5 w-6">
                          <div className="w-3 h-3 rounded-sm" style={{ background: row.color }} />
                        </td>
                        <td className="px-3 py-2.5">
                          {row.editingName
                            ? <input autoFocus defaultValue={row.name} className="w-full text-sm border border-slate-300 rounded px-2 py-0.5"
                                onBlur={e => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, name: e.target.value, editingName: false } : r))}
                                onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
                            : <span onDoubleClick={() => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, editingName: true } : r))}
                                className="cursor-text block">{row.name}</span>
                          }
                        </td>
                        <td className="px-3 py-2.5">
                          {row.editingQty
                            ? <input type="number" autoFocus defaultValue={row.qty} className="w-20 text-sm border border-slate-300 rounded px-2 py-0.5"
                                onBlur={e => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, qty: +e.target.value || 0, editingQty: false } : r))}
                                onKeyDown={e => e.key === 'Enter' && e.target.blur()} />
                            : <span onDoubleClick={() => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, editingQty: true } : r))}
                                className="cursor-text font-medium">{row.qty} <span className="text-slate-400 text-xs">→ {net}</span></span>
                          }
                        </td>
                        <td className="px-3 py-2.5">
                          <input type="number" value={row.wastage} min={0} max={100} step={1}
                            onChange={e => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, wastage: +e.target.value } : r))}
                            className="w-16 text-sm border border-slate-200 rounded px-2 py-0.5" />
                        </td>
                        <td className="px-3 py-2.5">
                          <input type="number" value={row.unitCost} min={0} step={1}
                            onChange={e => setSummaryRows(prev => prev.map(r => r.id === row.id ? { ...r, unitCost: +e.target.value } : r))}
                            className="w-28 text-sm border border-slate-200 rounded px-2 py-0.5" />
                        </td>
                        <td className="px-3 py-2.5 font-medium">
                          {total > 0 ? '฿' + total.toLocaleString() : <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <button onClick={() => setSummaryRows(prev => prev.filter(r => r.id !== row.id))}
                            className="text-slate-300 hover:text-red-400 text-xs">✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50 border-t border-slate-200 font-medium">
                    <td colSpan={5} className="px-3 py-3 text-sm text-slate-600">ราคารวมทั้งโครงการ</td>
                    <td className="px-3 py-3 text-base text-slate-800">
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

      {/* ===== POPUP: ตั้งชื่อสัญลักษณ์ ===== */}
      {showNamePopup && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={e => { if (e.target === e.currentTarget) { setShowNamePopup(false); setDrawBox(null) } }}>
          <div className="bg-white rounded-xl p-6 w-80 border border-slate-200 shadow-lg">
            <p className="font-semibold text-base mb-4">บันทึกสัญลักษณ์ใหม่</p>

            {pendingBox && pdfCanvasRef.current && (
              <div className="mb-4 flex justify-center">
                <canvas
                  ref={c => {
                    if (c && pdfCanvasRef.current && pendingBox) {
                      c.width = Math.round(pendingBox.w)
                      c.height = Math.round(pendingBox.h)
                      c.style.maxWidth = '120px'
                      c.style.maxHeight = '120px'
                      c.style.objectFit = 'contain'
                      c.getContext('2d').drawImage(
                        pdfCanvasRef.current,
                        Math.round(pendingBox.x), Math.round(pendingBox.y),
                        Math.round(pendingBox.w), Math.round(pendingBox.h),
                        0, 0, Math.round(pendingBox.w), Math.round(pendingBox.h)
                      )
                    }
                  }}
                  className="border border-slate-200 rounded bg-white"
                />
              </div>
            )}

            <div className="mb-3">
              <label className="block text-xs text-slate-500 mb-1">ชื่ออุปกรณ์</label>
              <input value={newDeviceName} onChange={e => setNewDeviceName(e.target.value)}
                placeholder="เช่น เต้าเสียบ 2P, Downlight 6W"
                className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg focus:outline-none focus:border-blue-400"
                onKeyDown={e => e.key === 'Enter' && handleSaveSymbol()}
                autoFocus />
            </div>

            <div className="mb-5">
              <label className="block text-xs text-slate-500 mb-2">สีไฮไลท์</label>
              <div className="flex gap-2 flex-wrap">
                {SYMBOL_COLORS.map(c => (
                  <div key={c} onClick={() => setNewDeviceColor(c)}
                    className="w-7 h-7 rounded-md cursor-pointer transition-transform hover:scale-110"
                    style={{ background: c, outline: newDeviceColor === c ? `3px solid #1e40af` : '2px solid transparent', outlineOffset: 2 }} />
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={() => { setShowNamePopup(false); setDrawBox(null) }}
                className="flex-1 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600">ยกเลิก</button>
              <button onClick={handleSaveSymbol} disabled={!newDeviceName.trim()}
                className={`flex-2 py-2 px-4 text-sm rounded-lg font-medium transition-colors ${newDeviceName.trim() ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}`}>
                บันทึกสัญลักษณ์
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== MODAL: สร้างโปรเจกต์ใหม่ ===== */}
      {showProjectModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50"
          onClick={e => { if (e.target === e.currentTarget) setShowProjectModal(false) }}>
          <div className="bg-white rounded-xl p-6 w-72 border border-slate-200">
            <p className="font-semibold text-base mb-4">สร้างโปรเจกต์ใหม่</p>
            <input value={newProjectName} onChange={e => setNewProjectName(e.target.value)}
              placeholder="ชื่อโปรเจกต์ เช่น อาคาร A ชั้น 1"
              className="w-full text-sm px-3 py-2 border border-slate-200 rounded-lg mb-4 focus:outline-none focus:border-blue-400"
              onKeyDown={e => e.key === 'Enter' && createProject()}
              autoFocus />
            <div className="flex gap-2">
              <button onClick={() => setShowProjectModal(false)} className="flex-1 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50">ยกเลิก</button>
              <button onClick={createProject} disabled={!newProjectName.trim()} className="flex-2 py-2 px-4 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium">สร้าง</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
