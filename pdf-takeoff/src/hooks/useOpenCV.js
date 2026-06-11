// useOpenCV.js
// Template matching engine using OpenCV.js
// รัน client-side ทั้งหมด — ไม่มีค่า API ไม่มี server

import { useState, useEffect, useRef, useCallback } from 'react'

const OPENCV_URL = 'https://docs.opencv.org/4.8.0/opencv.js'

export function useOpenCV() {
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const cvRef = useRef(null)

  useEffect(() => {
    // โหลด OpenCV.js ครั้งเดียว
    if (window.cv) {
      cvRef.current = window.cv
      setReady(true)
      return
    }

    setLoading(true)
    const script = document.createElement('script')
    script.src = OPENCV_URL
    script.async = true

    script.onload = () => {
      // OpenCV.js ต้องรอ Module init
      const waitForCV = setInterval(() => {
        if (window.cv && window.cv.Mat) {
          clearInterval(waitForCV)
          cvRef.current = window.cv
          setReady(true)
          setLoading(false)
        }
      }, 100)
    }

    script.onerror = () => {
      console.error('โหลด OpenCV.js ไม่สำเร็จ')
      setLoading(false)
    }

    document.head.appendChild(script)
    return () => {}
  }, [])

  /**
   * runTemplateMatch
   * @param {HTMLCanvasElement} sourceCanvas - canvas ของหน้า PDF ทั้งหน้า
   * @param {HTMLCanvasElement} templateCanvas - canvas ของสัญลักษณ์ที่ครอบไว้
   * @param {number} threshold - ค่าความแม่นยำขั้นต่ำ 0–1
   * @returns {Array<{x, y, w, h, confidence}>}
   */
  const runTemplateMatch = useCallback((sourceCanvas, templateCanvas, threshold = 0.6) => {
    const cv = cvRef.current
    if (!cv) return []

    let src = null, templ = null, result = null, srcGray = null, templGray = null

    try {
      src = cv.imread(sourceCanvas)
      templ = cv.imread(templateCanvas)

      // แปลงเป็น grayscale เพื่อความแม่นยำและความเร็ว
      srcGray = new cv.Mat()
      templGray = new cv.Mat()
      cv.cvtColor(src, srcGray, cv.COLOR_RGBA2GRAY)
      cv.cvtColor(templ, templGray, cv.COLOR_RGBA2GRAY)

      const W = src.cols - templ.cols + 1
      const H = src.rows - templ.rows + 1

      if (W <= 0 || H <= 0) return []

      result = new cv.Mat()
      cv.matchTemplate(srcGray, templGray, result, cv.TM_CCOEFF_NORMED)

      const matches = []
      const usedZones = [] // ป้องกัน overlap ซ้ำ

      // วนหาทุกจุดที่เกิน threshold
      for (let y = 0; y < result.rows; y++) {
        for (let x = 0; x < result.cols; x++) {
          const confidence = result.floatAt(y, x)
          if (confidence >= threshold) {
            // ตรวจว่า overlap กับที่เจอแล้วไหม (Non-Maximum Suppression แบบง่าย)
            const cx = x + templ.cols / 2
            const cy = y + templ.rows / 2
            const overlapping = usedZones.some(
              z => Math.abs(z.cx - cx) < templ.cols * 0.6 && Math.abs(z.cy - cy) < templ.rows * 0.6
            )
            if (!overlapping) {
              matches.push({ x, y, w: templ.cols, h: templ.rows, confidence: Math.round(confidence * 100) / 100 })
              usedZones.push({ cx, cy })
            }
          }
        }
      }

      return matches
    } catch (err) {
      console.error('Template matching error:', err)
      return []
    } finally {
      // คืน memory ทุกครั้ง (สำคัญมากสำหรับ OpenCV.js)
      if (src) src.delete()
      if (templ) templ.delete()
      if (result) result.delete()
      if (srcGray) srcGray.delete()
      if (templGray) templGray.delete()
    }
  }, [])

  /**
   * extractRegion — ตัดส่วนของ canvas ออกมาเป็น canvas ใหม่
   * ใช้ตอนครอบ bounding box บน PDF
   */
  const extractRegion = useCallback((sourceCanvas, x, y, w, h) => {
    const offscreen = document.createElement('canvas')
    offscreen.width = Math.max(1, Math.round(w))
    offscreen.height = Math.max(1, Math.round(h))
    const ctx = offscreen.getContext('2d')
    ctx.drawImage(sourceCanvas, Math.round(x), Math.round(y), Math.round(w), Math.round(h), 0, 0, offscreen.width, offscreen.height)
    return offscreen
  }, [])

  return { ready, loading, runTemplateMatch, extractRegion }
}
