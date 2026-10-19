import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pdfPath = path.resolve(__dirname, '../docs/FINAL_HANDOVER_REPORT.pdf');
const pdf = fs.readFileSync(pdfPath);
const b64 = pdf.toString('base64');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Download Final Handover Report - Dental CMS</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; color: #0f172a; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
    .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 36px 32px; max-width: 500px; width: 100%; box-shadow: 0 10px 15px -3px rgba(0,0,0,0.06); text-align: center; }
    .icon { width: 64px; height: 64px; background: #eff6ff; color: #2563eb; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 20px; }
    h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; color: #0f172a; }
    p { color: #64748b; font-size: 14px; margin-bottom: 24px; line-height: 1.5; }
    .btn { display: block; width: 100%; padding: 13px 20px; border-radius: 8px; font-weight: 600; font-size: 14px; text-decoration: none; cursor: pointer; border: none; transition: all 0.2s; margin-bottom: 12px; box-sizing: border-box; }
    .btn-primary { background: #2563eb; color: #ffffff; }
    .btn-primary:hover { background: #1d4ed8; }
    .btn-outline { background: #ffffff; color: #334155; border: 1px solid #cbd5e1; }
    .btn-outline:hover { background: #f1f5f9; }
    .meta { font-size: 12px; color: #94a3b8; margin-top: 20px; border-top: 1px solid #f1f5f9; padding-top: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    </div>
    <h1>Dental CMS Handover Report</h1>
    <p>The technical handover report is ready for download in PDF format (291 KB, A4 formatted, 29/29 automated tests verified).</p>
    
    <button class="btn btn-primary" id="downloadBtn">Download PDF Directly</button>
    <a class="btn btn-outline" href="http://localhost:3333/view" target="_blank">Open / Preview in Browser</a>
    <a class="btn btn-outline" href="http://localhost:3333/" download>Download via Local HTTP Server</a>

    <div class="meta">Dental Laboratory Case Management System &bull; October 2026</div>
  </div>

  <script>
    const b64Data = "${b64}";
    document.getElementById('downloadBtn').addEventListener('click', () => {
      const byteCharacters = atob(b64Data);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      const blob = new Blob([byteArray], { type: 'application/pdf' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'Dental_CMS_Final_Handover_Report.pdf';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    });
  </script>
</body>
</html>`;

fs.writeFileSync(path.resolve(__dirname, '../docs/DOWNLOAD_REPORT.html'), html);
fs.writeFileSync(path.resolve(__dirname, '../public/DOWNLOAD_REPORT.html'), html);
console.log('Successfully generated DOWNLOAD_REPORT.html');
