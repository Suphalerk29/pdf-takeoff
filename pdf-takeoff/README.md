# PDF Takeoff — ถอดปริมาณอุปกรณ์จากแบบแปลน

แอปถอดปริมาณอุปกรณ์จาก PDF แบบแปลน AutoCAD/Revit
สแกนสัญลักษณ์อัตโนมัติด้วย OpenCV.js (ฟรี, ทำงาน offline)

---

## วิธีรันบนเครื่อง (Local)

ต้องติดตั้ง Node.js ก่อน → https://nodejs.org (แนะนำ v18+)

```bash
# 1. ติดตั้ง dependencies
npm install

# 2. รัน dev server
npm run dev

# 3. เปิดเบราว์เซอร์ที่ http://localhost:5173
```

---

## วิธี Deploy ขึ้น Vercel (ฟรี ทีมเปิดใช้ได้เลย)

### ขั้นตอนที่ 1 — อัปโหลดโค้ดขึ้น GitHub

1. ไปที่ https://github.com → กด "New repository"
2. ตั้งชื่อ เช่น `pdf-takeoff` → กด "Create repository"
3. รันคำสั่งนี้ในโฟลเดอร์โปรเจกต์:

```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/pdf-takeoff.git
git push -u origin main
```

### ขั้นตอนที่ 2 — Deploy บน Vercel

1. ไปที่ https://vercel.com → สมัครด้วย GitHub account
2. กด "Add New Project"
3. เลือก repo `pdf-takeoff` → กด "Import"
4. Vercel จะตรวจพบว่าเป็น Vite project อัตโนมัติ
5. กด **"Deploy"** — รอประมาณ 1 นาที
6. ได้ URL เช่น `https://pdf-takeoff-xxx.vercel.app` — แชร์ให้ทีมได้เลย

### ขั้นตอนที่ 3 — อัปเดตโค้ดในอนาคต

```bash
git add .
git commit -m "อัปเดต..."
git push
# Vercel จะ deploy ให้อัตโนมัติ
```

---

## วิธีใช้งาน

### 1. เริ่มโปรเจกต์
- กด **"+ ใหม่"** ที่ด้านบน → ตั้งชื่อโปรเจกต์
- อัปโหลด PDF แบบแปลน (รองรับทุกขนาด, หลายหน้า)

### 2. ครอบสัญลักษณ์
- เลือกเครื่องมือ **"ครอบสัญลักษณ์"** (⊡)
- ลากครอบกล่องรอบสัญลักษณ์ตัวอย่างบน PDF
- ตั้งชื่ออุปกรณ์ + เลือกสี → กด "บันทึกสัญลักษณ์"
- ทำซ้ำสำหรับทุกประเภทสัญลักษณ์ที่ต้องการนับ

### 3. Run Scan
- ปรับ **ค่าความแม่นยำ** (แนะนำ 60–75%)
- กด **"▶ Run Scan"** — ระบบจะสแกนทุกหน้า PDF
- รอจนเสร็จ (ขึ้นกับขนาด PDF และจำนวนสัญลักษณ์)

### 4. ตรวจสอบผลลัพธ์
- ไปที่แท็บ **"ตรวจสอบ"**
- กด **✓ Approve** หรือ **✕ Reject** แต่ละรายการ
- กด "ดู" เพื่อ zoom ไปจุดนั้นบนแบบแปลน

### 5. สรุปปริมาณ
- ไปที่แท็บ **"สรุปปริมาณ"**
- ดับเบิ้ลคลิกแก้ชื่อหรือจำนวนได้
- ใส่ค่าเผื่อสูญเสีย % และราคา/หน่วย
- กด **"Export Excel (.xlsx)"** ดาวน์โหลดตารางสรุป

### 6. บันทึกโปรเจกต์
- กด **"บันทึก"** ด้านบน — ข้อมูลเก็บใน browser (localStorage)
- เปิดเครื่องใหม่ข้อมูลยังอยู่ครบ

---

## Tips สำหรับผลลัพธ์ที่ดีที่สุด

- ครอบสัญลักษณ์ให้กระชับพอดี ไม่ติดเส้น หรือสัญลักษณ์อื่น
- ถ้าสัญลักษณ์มีขนาดต่างกันในแบบ ให้ปรับ zoom ก่อน แล้วครอบที่ scale จริง
- ค่า threshold 60–70% เหมาะกับ PDF จาก AutoCAD ที่ clean
- ถ้า false positive เยอะ → เพิ่ม threshold ขึ้น
- ถ้าหา match ไม่พอ → ลด threshold ลง

---

## Tech Stack

| ส่วน | Technology |
|------|-----------|
| Frontend | React 18 + Vite |
| Styling | Tailwind CSS |
| PDF Render | PDF.js (pdfjs-dist) |
| Template Matching | OpenCV.js 4.8 |
| Export | SheetJS (xlsx) |
| Storage | localStorage |
| Deploy | Vercel (ฟรี) |
