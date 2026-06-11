import { Response } from 'express';
import mongoose from 'mongoose';
import { AuthRequest } from '../middleware/authMiddleware';

import Case from '../models/caseModel';
import Task from '../models/taskModel';
import AuditLog from '../models/auditLogModel';
import Event from '../models/eventModel';
import Document from '../models/documentModel';

import ClientReport from '../models/clientReportModel';

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const text = (v: any) => (v === null || v === undefined ? '' : String(v));
const safe = (v: any) =>
  text(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
const nl2br = (v: any) => safe(v).replace(/\n/g, '<br/>');
const linesFromText = (value?: any) =>
  text(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
const formatDate = (d: Date) => d.toISOString().slice(0, 10); // YYYY-MM-DD
const displayDate = (d?: any) => {
  if (!d) return '';
  const parsed = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(parsed.getTime())) return text(d);
  return parsed.toLocaleDateString('en-GB');
};

const getLogoDataUri = () => {
  const candidates = [
    path.resolve(process.cwd(), '../src/assets/logo-colin.png'),
    path.resolve(process.cwd(), 'src/assets/logo-colin.png'),
    path.resolve(__dirname, '../../../src/assets/logo-colin.png'),
  ];

  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) return '';
  return `data:image/png;base64,${fs.readFileSync(found).toString('base64')}`;
};

const wrapHtmlDoc = (title: string, bodyHtml: string) => {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${safe(title)}</title>
  <style>
    @page { size: A4; margin: 10mm 12mm 28mm; }
    html, body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #111; background: #fff; }
    * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-size: 10.5pt; line-height: 1.42; }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
};

const buildHtml = (payload: {
  caseNo: string;
  parties: string;
  caseType: string;
  updateReportDate?: string;
  reportPeriodLabel?: string;
  reportTypeLabel?: string;
  status: string;
  priority?: string;
  assignedTo?: string;
  description?: string;
  serviceRequested?: string;
  clientName?: string;
  clientAddress?: string;
  clientEmail?: string;
  clientPhone?: string;
  salutation?: string;
  introduction?: string;
  workDone?: string;
  nextAction?: string;
  nextActionDate?: string;
  upcomingMilestone?: string;
  clientInputDecision?: string;
  recentDevelopment?: string;
  closing?: string;
  signatureName?: string;
  reportKind: 'Weekly' | 'Monthly' | 'Manual';
  periodStart: Date;
  periodEnd: Date;

  updates: { createdAt: string; action?: string; message: string; detail?: string; actorName?: string }[];
  tasks: { title: string; status: string; assignee: string; dueDate?: string; priority?: string; description?: string }[];
  events: { title: string; type: string; date: string; time?: string; description?: string }[];
  documents: { name: string; uploadedDate: string; uploadedBy: string; category?: string; size?: string }[];
}) => {
  const logo = getLogoDataUri();
  const reportDate = payload.updateReportDate || displayDate(payload.periodEnd);
  const periodLabel = payload.reportPeriodLabel || `${displayDate(payload.periodStart)} to ${displayDate(payload.periodEnd)}`;
  const reportTypeLabel = payload.reportTypeLabel || `${payload.reportKind} update`;
  const upcomingEvents = payload.events.slice(0, 6);
  const pendingTasks = payload.tasks.filter((task) => task.status !== 'Completed').slice(0, 8);
  const completedTasks = payload.tasks.filter((task) => task.status === 'Completed').slice(0, 8);
  const nextAction = pendingTasks[0] || payload.tasks[0];
  const caseSummary =
    payload.description ||
    `This matter concerns ${payload.parties || 'the client matter'} and is currently at ${payload.status || 'the active stage'}.`;
  const serviceRequested = payload.serviceRequested || payload.caseType || 'Legal services';
  const generatedWorkDoneItems = [
    ...completedTasks.map((task) => task.title),
    ...payload.updates.slice(0, 5).map((update) => update.message),
    ...payload.documents.slice(0, 3).map((doc) => `Reviewed or added document: ${doc.name}`),
  ].filter(Boolean);
  const generatedMilestoneItems = [
    ...pendingTasks.map((task) => `${task.title}${task.dueDate ? ` - due ${task.dueDate}` : ''}`),
    ...upcomingEvents.map((event) => `${event.title}${event.date ? ` - ${event.date}` : ''}`),
  ].filter(Boolean);
  const workDoneItems = linesFromText(payload.workDone).length ? linesFromText(payload.workDone) : generatedWorkDoneItems;
  const milestoneItems = linesFromText(payload.upcomingMilestone).length
    ? linesFromText(payload.upcomingMilestone)
    : generatedMilestoneItems;
  const recentDevelopmentItems = linesFromText(payload.recentDevelopment).length
    ? linesFromText(payload.recentDevelopment)
    : payload.updates.slice(0, 8).map((u) => {
        const who = u.actorName ? ` - ${u.actorName}` : '';
        const detail = u.detail ? ` (${u.detail})` : '';
        return `${u.createdAt}${who}: ${u.message}${detail}`;
      });
  const intro =
    payload.introduction ||
    `We hereby present the updated progress report of the matters we are handling on behalf of ${
      payload.clientName || payload.parties || 'you'
    }.`;
  const closing =
    payload.closing ||
    `We want to reassure you that our team is actively and dedicatedly pursuing your case, aiming for the best possible outcome. Should you have any inquiries regarding the progress of your case or any related issues, please feel free to reach out to us.\n\nThank you for choosing us to handle your legal matters. We value your ongoing cooperation and trust.`;
  const closingHtml = nl2br(closing)
    .split('<br/><br/>')
    .map((paragraph) => `<p>${paragraph}</p>`)
    .join('');

  const bulletList = (items: string[], emptyText: string) =>
    items.length
      ? `<ul class="report-list">${items.map((item) => `<li>${nl2br(item)}</li>`).join('')}</ul>`
      : `<p class="muted">${safe(emptyText)}</p>`;

  return `
  <style>
    /* Reserve consistent footer space and allow content to break across pages when needed */
    .report-page { min-height: 100vh; padding: 0 4mm 32mm; position: relative; box-sizing: border-box; }
    .report-content { box-sizing: border-box; }
    .topline { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
    .logo { width: 188px; height: auto; object-fit: contain; }
    .date { font-size: 10pt; white-space: nowrap; padding-top: 8px; }
    .client-block { margin: 10px 0 26px 0; line-height: 1.5; }
    .salutation { margin: 0 0 12px 0; }
    h1 { text-align: center; margin: 0 0 18px 0; font-size: 15pt; letter-spacing: 0; text-decoration: underline; }
    h2 { margin: 18px 0 8px 0; font-size: 11pt; text-transform: uppercase; }
    h3 { margin: 14px 0 8px 0; font-size: 10.5pt; text-transform: uppercase; }
    p { margin: 0 0 8px 0; }
    .intro { margin-bottom: 14px; }
    /* Allow long sections to break across pages to avoid overflow into footer */
    .report-section { break-inside: auto; page-break-inside: auto; }
    h2, h3 { break-after: avoid; page-break-after: avoid; }
    .case-summary { border: 1px solid #777; padding: 10px 12px; margin: 8px 0 0; overflow-wrap: anywhere; page-break-inside: auto; }
    .case-summary .summary-label { font-weight: 700; margin-bottom: 5px; }
    .info-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    .info-table td { border: 1px solid #777; vertical-align: top; padding: 8px 9px; overflow-wrap: anywhere; word-break: normal; }
    .info-table .label { width: 24%; font-weight: 700; background: #f3f3f3; }
    .info-table .value { width: 26%; }
    .section-box { border: 1px solid #777; padding: 10px 12px; margin: 8px 0 14px; min-height: 34px; overflow-wrap: anywhere; page-break-inside: auto; }
    .split-row { display: grid; grid-template-columns: 1fr 150px; gap: 18px; align-items: start; }
    .report-list { margin: 0; padding-left: 18px; }
    .report-list li { margin: 4px 0; }
    .muted { color: #555; }
    .status-grid { display: grid; grid-template-columns: 150px 1fr; border: 1px solid #777; margin: 8px 0 14px; overflow-wrap: anywhere; }
    .status-grid div { padding: 8px 10px; border-bottom: 1px solid #777; }
    .status-grid div:nth-last-child(-n + 2) { border-bottom: 0; }
    .status-grid .label { font-weight: 700; background: #f3f3f3; border-right: 1px solid #777; }
    .closing { margin-top: 22px; }
    .signature { margin-top: 22px; }
    .print-footer { position: fixed; left: 12mm; right: 12mm; bottom: 4mm; min-height: 18mm; font-family: Arial, sans-serif; font-size: 8.3pt; color: #111; background: #fff; box-shadow: none; }
    .motto { text-align: center; font-weight: 700; letter-spacing: .3px; margin-bottom: 4px; }
    .footer-lines { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; border-top: 1px solid #333; padding-top: 4px; }
    .footer-lines div { line-height: 1.35; }
    @media screen {
      .print-footer { position: static; margin-top: 28px; }
    }
  </style>
  <div class="report-page">
  <div class="report-content">
    <div class="topline">
      <div>${logo ? `<img class="logo" src="${logo}" alt="Colin & Colin" />` : '<strong>COLIN & COLIN</strong>'}</div>
      <div class="date">Date: ${safe(reportDate)}</div>
    </div>

    <div class="client-block">
      <strong>${safe(payload.clientName || payload.parties || 'Client')}</strong><br/>
      ${nl2br(payload.clientAddress || 'Kigali, RWANDA')}${payload.clientPhone ? `<br/>Tel: ${safe(payload.clientPhone)}` : ''}${
        payload.clientEmail ? `<br/>Email: ${safe(payload.clientEmail)}` : ''
      }
    </div>

    <p class="salutation">${safe(payload.salutation || 'Dear Sir/Madam,')}</p>
    <h1>UPDATE REPORT</h1>
    <p class="intro">${nl2br(intro)}</p>

    <div class="report-section">
    <h2>1. Case Information</h2>
    <div class="case-summary">
      <div class="summary-label">Case Summary</div>
      <div>${nl2br(caseSummary)}</div>
    </div>
    <table class="info-table">
      <tr>
        <td class="label">Case Parties</td>
        <td class="value">${safe(payload.parties)}</td>
        <td class="label">Update Report Date</td>
        <td class="value">${safe(reportDate)}</td>
      </tr>
      <tr>
        <td class="label">Case Number</td>
        <td class="value">${safe(payload.caseNo || '-')}</td>
        <td class="label">Service Requested</td>
        <td class="value">${safe(serviceRequested)}</td>
      </tr>
      <tr>
        <td class="label">Case Type</td>
        <td class="value">${safe(payload.caseType)}</td>
        <td class="label">Partner & Associate In Charge</td>
        <td class="value">${safe(payload.assignedTo || 'Me. Colin GATETE')}</td>
      </tr>
      <tr>
        <td class="label">Report Period</td>
        <td class="value">${safe(periodLabel)}</td>
        <td class="label">Report Type</td>
        <td class="value">${safe(reportTypeLabel)}</td>
      </tr>
    </table>
    </div>

    <div class="report-section">
    <h2>2. Work Done</h2>
    <div class="section-box">${bulletList(workDoneItems.slice(0, 8), 'No work updates were recorded for this reporting period.')}</div>
    </div>

    <div class="report-section">
    <h2>3. Next Action</h2>
    <div class="section-box split-row">
      <div>${nl2br(payload.nextAction || nextAction?.title || 'Continue following up on the matter and update the client once a material development occurs.')}</div>
      <div>${safe(payload.nextActionDate || nextAction?.dueDate || upcomingEvents[0]?.date || '') || '&nbsp;'}</div>
    </div>
    </div>

    <div class="report-section">
    <h2>4. Upcoming Milestone</h2>
    <div class="section-box">${bulletList(milestoneItems.slice(0, 8), 'No upcoming milestone is currently scheduled.')}</div>
    </div>

    <div class="report-section">
    <h2>5. Client Input And Decision</h2>
    <div class="section-box">
      ${payload.clientInputDecision ? nl2br(payload.clientInputDecision) : '<p class="muted">Client input, approval, instructions, or decision required will be recorded here when applicable.</p>'}
    </div>
    </div>

    <div class="report-section">
    <h2>Case Overview</h2>
    <div class="status-grid">
      <div class="label">Overall Status</div><div>${safe(payload.status || 'Active')}</div>
      <div class="label">Priority</div><div>${safe(payload.priority || 'Medium')}</div>
      <div class="label">Case Number</div><div>${safe(payload.caseNo || '-')}</div>
    </div>
    </div>

    <div class="report-section">
    <h2>Recent Development</h2>
    <div class="section-box">
      ${bulletList(recentDevelopmentItems, 'No recent developments were recorded in this period.')}
    </div>
    </div>

    <div class="closing">
      ${closingHtml}
    </div>

    <div class="signature">
      <p>Sincerely,</p>
      <p><strong>${safe(payload.signatureName || 'Colin & Colin Legal Solutions')}</strong></p>
    </div>
    </div>

    <div class="print-footer">
      <div class="motto">COMMITTED TO EXCELLENCE</div>
      <div class="footer-lines">
        <div>T +250 788 883 311 | M +250 788 300 401 | W www.colinandcolin.com<br/>E info@colinandcolin.com</div>
        <div>A EDC Plaza (Adjacent to the Swiss Embassy)<br/>KN 4 Avenue, Kigali City, Republic of Rwanda</div>
      </div>
    </div>
  </div>
  `;
};

export const listReportsForCase = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId } = req.params as any;

    const reports = await ClientReport.find({
      caseId: new mongoose.Types.ObjectId(caseId),
    }).sort({ createdAt: -1 });

    res.json(reports);
  } catch {
    res.status(500).json({ message: 'Failed to load reports.' });
  }
};

export const generateReportForCase = async (req: AuthRequest, res: Response) => {
  try {
    const { caseId } = req.params as any;
    if (!caseId) return res.status(400).json({ message: 'Missing caseId' });

    const c: any = await Case.findById(caseId);
    if (!c) return res.status(404).json({ message: 'Case not found.' });

    const now = new Date();
    const requestedTrigger = ['weekly', 'monthly', 'update'].includes(String(req.body?.trigger))
      ? String(req.body.trigger)
      : 'manual';
    const periodDays =
      requestedTrigger === 'weekly'
        ? 7
        : requestedTrigger === 'monthly'
          ? 30
          : Math.min(180, Math.max(7, Number(req.body?.periodDays || 30)));
    const periodEnd = now;
    const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
    const reportKind = requestedTrigger === 'weekly' ? 'Weekly' : requestedTrigger === 'monthly' ? 'Monthly' : 'Manual';

    const todayStr = formatDate(now);

    const [tasks, audit, events, docs] = await Promise.all([
      Task.find({ caseId: new mongoose.Types.ObjectId(caseId) }).sort({ dueDate: 1, createdAt: -1 }).lean(),

      AuditLog.find({
        caseId: new mongoose.Types.ObjectId(caseId),
        createdAt: { $gte: periodStart, $lte: periodEnd },
      })
        .sort({ createdAt: -1 })
        .lean(),

      Event.find({
        caseId: new mongoose.Types.ObjectId(caseId),
        date: { $gte: todayStr },
      })
        .sort({ date: 1 })
        .lean(),

      Document.find({
        caseId: new mongoose.Types.ObjectId(caseId),
        createdAt: { $gte: periodStart, $lte: periodEnd },
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    const recipients = (c.clientContacts || []).filter((r: any) => r.email);
    const primaryContact = recipients.find((r: any) => r.isPrimary) || recipients[0] || {};
    const serviceRequested =
      Array.isArray(c.legalServicePath) && c.legalServicePath.length
        ? c.legalServicePath.map((item: any) => item.label).filter(Boolean).join(' / ')
        : c.matterType || c.workflow || c.caseType;
    const reportTemplate = {
      ...((c.reporting && c.reporting.reportTemplate) || {}),
      ...((req.body && req.body.reportTemplate) || {}),
    };

    const subject = `${reportKind} Update Report - ${text(c.caseNo)} - ${text(c.parties)} - ${formatDate(periodEnd)}`;

    const html = buildHtml({
      caseNo: reportTemplate.caseNumber || c.caseNo,
      parties: reportTemplate.caseParties || c.parties,
      caseType: reportTemplate.caseTypeLabel || c.caseType,
      updateReportDate: reportTemplate.updateReportDate,
      reportPeriodLabel: reportTemplate.reportPeriodLabel,
      reportTypeLabel: reportTemplate.reportTypeLabel,
      status: reportTemplate.overallStatus || c.status,
      priority: reportTemplate.priority || c.priority,
      assignedTo: reportTemplate.partnerInCharge || c.assignedTo,
      description: reportTemplate.caseSummary || c.description,
      serviceRequested: reportTemplate.serviceRequested || serviceRequested,
      clientName: reportTemplate.clientName || primaryContact.name || c.parties,
      clientAddress: reportTemplate.clientAddress,
      clientEmail: reportTemplate.clientEmail || primaryContact.email,
      clientPhone: reportTemplate.clientPhone || primaryContact.phone,
      salutation: reportTemplate.salutation,
      introduction: reportTemplate.introduction,
      workDone: reportTemplate.workDone,
      nextAction: reportTemplate.nextAction,
      nextActionDate: reportTemplate.nextActionDate,
      upcomingMilestone: reportTemplate.upcomingMilestone,
      clientInputDecision: reportTemplate.clientInputDecision,
      recentDevelopment: reportTemplate.recentDevelopment,
      closing: reportTemplate.closing,
      signatureName: reportTemplate.signatureName,
      reportKind,
      periodStart,
      periodEnd,

      updates: (audit || []).map((a: any) => ({
        createdAt: new Date(a.createdAt).toLocaleString(),
        message: text(a.message),
        ...(a.action ? { action: text(a.action) } : {}),
        ...(a.detail ? { detail: text(a.detail) } : {}),
        ...(a.actorName ? { actorName: text(a.actorName) } : {}),
      })),

      tasks: (tasks || []).map((t: any) => ({
        title: text(t.title),
        status: text(t.status),
        assignee: text(t.assignee),
        ...(t.priority ? { priority: text(t.priority) } : {}),
        ...(t.dueDate ? { dueDate: text(t.dueDate) } : {}),
        ...(t.description ? { description: text(t.description) } : {}),
      })),

      events: (events || []).map((e: any) => ({
        title: text(e.title),
        type: text(e.type),
        date: text(e.date),
        ...(e.time ? { time: text(e.time) } : {}),
        ...(e.description ? { description: text(e.description) } : {}),
      })),

      documents: (docs || []).map((d: any) => ({
        name: text(d.name),
        uploadedDate: d.uploadedDate ? text(d.uploadedDate) : new Date(d.createdAt).toLocaleDateString(),
        uploadedBy: text(d.uploadedBy),
        ...(d.category ? { category: text(d.category) } : {}),
        ...(d.size ? { size: text(d.size) } : {}),
      })),
    });

    const report = await ClientReport.create({
      caseId: new mongoose.Types.ObjectId(caseId),
      trigger: requestedTrigger,
      status: 'Draft',
      periodStart,
      periodEnd,
      subject,
      recipients,
      contentHtml: html,
      generatedBy: req.user?.name || 'System',
      ...(req.user?.id ? { generatedByUserId: new mongoose.Types.ObjectId(req.user.id) } : {}),
    });

    await Case.findByIdAndUpdate(caseId, { 'reporting.lastGeneratedAt': now });

    res.status(201).json(report);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to generate report.' });
  }
};

export const getReportById = async (req: AuthRequest, res: Response) => {
  try {
    const { reportId } = req.params as any;
    const report = await ClientReport.findById(reportId);
    if (!report) return res.status(404).json({ message: 'Report not found.' });
    res.json(report);
  } catch {
    res.status(500).json({ message: 'Failed to load report.' });
  }
};

// ✅ NEW: PDF download endpoint (no email)
export const downloadReportPdf = async (req: AuthRequest, res: Response) => {
  const { reportId } = req.params as any;

  if (!reportId) return res.status(400).json({ message: 'Missing reportId' });
  if (!mongoose.isValidObjectId(reportId)) return res.status(400).json({ message: 'Invalid reportId' });

  const report: any = await ClientReport.findById(reportId);
  if (!report) return res.status(404).json({ message: 'Report not found.' });

  // Try to build a meaningful filename
  const filenameSafe = String(report.subject || 'case-report')
    .replace(/[^\w\s\-().]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

  const fileName = `${filenameSafe}.pdf`;

  const htmlDoc = wrapHtmlDoc(report.subject || 'Case Report', report.contentHtml || '<div>No content</div>');
  // Sanitize HTML to avoid executing any embedded scripts or inline event handlers
  // which can cause runtime errors inside Playwright's page.evaluate.
  const sanitizeHtml = (s: string) =>
    String(s || '')
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
      .replace(/on\w+\s*=(("|').*?\2|[^>\s]+)/gi, '');
  const sanitizedHtmlDoc = sanitizeHtml(htmlDoc);
  const hadScripts = /<script\b/i.test(htmlDoc) || /on\w+=/i.test(htmlDoc);
  const debugDir = path.resolve(process.cwd(), '.debug', 'client-reports');
  fs.mkdirSync(debugDir, { recursive: true });
  const debugBase = `${String(reportId).replace(/[^\w-]/g, '')}-${Date.now()}`;
  const initialHtmlPath = path.join(debugDir, `${debugBase}-initial.html`);
  const finalHtmlPath = path.join(debugDir, `${debugBase}-final.html`);
  const screenshotPath = path.join(debugDir, `${debugBase}-before-pdf.png`);
  fs.writeFileSync(initialHtmlPath, htmlDoc);

  // Render PDF
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
    // Use sanitized HTML when rendering in Playwright to avoid running unexpected scripts.
    let usedSimpleFallback = false;
    try {
      await page.setContent(sanitizedHtmlDoc, { waitUntil: 'networkidle' });
      if (hadScripts) {
        console.warn('[ClientReportPDF] Sanitized HTML removed script tags or inline handlers for report', { reportId: String(reportId) });
      }
    } catch (err: any) {
      // If setContent fails (e.g. due to template artifacts), fall back to a simple, safe HTML
      console.error('[ClientReportPDF] page.setContent(sanitizedHtmlDoc) failed, falling back to simple content', {
        reportId: String(reportId),
        message: err?.message || String(err),
      });
      const safeTextOnly = String(report.contentHtml || '').replace(/<[^>]+>/g, '');
      const simpleHtml = wrapHtmlDoc(report.subject || 'Case Report', `<div style="padding:20px;font-family:Arial, sans-serif;"><h1>${safe(report.subject || 'Case Report')}</h1><pre style="white-space:pre-wrap;">${safeTextOnly}</pre></div>`);
      await page.setContent(simpleHtml, { waitUntil: 'networkidle' });
      usedSimpleFallback = true;
    }
    if (usedSimpleFallback) console.warn('[ClientReportPDF] Used simple fallback HTML for report', { reportId: String(reportId) });
    await page.emulateMedia({ media: 'print' });

    // Measure footer height and try to add intelligent page breaks. If any DOM-evaluation
    // step fails (for example due to leftover page scripts), fall back to safe defaults
    // so PDF generation still succeeds.
    const pxToMm = (px: number) => (px * 25.4) / 96;
    let bottomMarginMm = 30; // default fallback
    let pageBreakResult: any = null;
    let finalMeasured: { footerHeight: number; reportPageHeight: number; contentHeight: number } = {
      footerHeight: 0,
      reportPageHeight: 0,
      contentHeight: 0,
    };

    try {
      // Measure footer and content sizes
      const measured = await page.evaluate(() => {
        const footer = document.querySelector('.print-footer');
        const reportPage = document.querySelector('.report-page');
        const content = document.querySelector('.report-content');
        if (!footer) return { footerHeight: 0, reportPageHeight: 0, contentHeight: 0 };
        const footerRect = footer.getBoundingClientRect();
        const footerStyle = window.getComputedStyle(footer);
        const marginTop = parseFloat(footerStyle.marginTop || '0') || 0;
        const marginBottom = parseFloat(footerStyle.marginBottom || '0') || 0;
        const total = footerRect.height + marginTop + marginBottom;
        return {
          footerHeight: total,
          reportPageHeight: reportPage ? (reportPage as HTMLElement).scrollHeight : 0,
          contentHeight: content ? (content as HTMLElement).scrollHeight : 0,
        };
      });

      const footerMm = measured && measured.footerHeight ? pxToMm(measured.footerHeight) : 0;
      const safetyMm = 10;
      bottomMarginMm = Math.max(30, Math.ceil(footerMm + safetyMm));

      try {
        await page.addStyleTag({ content: `.report-page { padding-bottom: ${bottomMarginMm}mm !important; }` });
      } catch (e) {
        console.warn('[ClientReportPDF] Failed to add padding style, continuing with computed bottom margin', e?.message || e);
      }

      // Try to add page breaks for large blocks; if this fails, we'll still continue.
      try {
        pageBreakResult = await page.evaluate(({ bottomMarginMm }) => {
          const mmToPx = (mm: number) => (mm * 96) / 25.4;
          const pageHeightPx = mmToPx(297);
          const topMarginPx = mmToPx(10);
          const bottomMarginPx = mmToPx(bottomMarginMm);
          const footerLimitPx = pageHeightPx - bottomMarginPx;
          const selectors = ['.report-section', '.closing', '.signature'];
          let breaksAdded = 0;

          for (let pass = 0; pass < 4; pass += 1) {
            let changed = false;
            const blocks = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
            blocks.forEach((block: any) => {
              const rect = block.getBoundingClientRect();
              const topInPage = ((rect.top % pageHeightPx) + pageHeightPx) % pageHeightPx;
              const bottomInPage = topInPage + rect.height;
              const fitsOnFreshPage = rect.height <= footerLimitPx - topMarginPx;
              if (fitsOnFreshPage && bottomInPage > footerLimitPx) {
                const currentMarginTop = parseFloat(window.getComputedStyle(block).marginTop || '0') || 0;
                const pushToNextPage = pageHeightPx - topInPage + topMarginPx;
                block.style.breakBefore = 'page';
                block.style.pageBreakBefore = 'always';
                block.style.marginTop = `${currentMarginTop + pushToNextPage}px`;
                breaksAdded += 1;
                changed = true;
              }
            });
            if (!changed) break;
          }

          const blocks = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
          const overlapBlocks = blocks
            .map((block: any) => {
              const rect = block.getBoundingClientRect();
              const topInPage = ((rect.top % pageHeightPx) + pageHeightPx) % pageHeightPx;
              const bottomInPage = topInPage + rect.height;
              return {
                tag: block.tagName.toLowerCase(),
                className: block.className,
                topInPage,
                bottomInPage,
                entersFooter: bottomInPage > footerLimitPx,
              };
            })
            .filter((item: any) => item.entersFooter);

          return { pageHeightPx, footerLimitPx, breaksAdded, overlapBlocks };
        }, { bottomMarginMm });
      } catch (e) {
        console.warn('[ClientReportPDF] page.evaluate for page breaks failed, continuing with defaults', e?.message || e);
      }

      // Add a temporary debug style and capture a screenshot & final markup for debugging.
      let debugStyle: any = null;
      try {
        debugStyle = await page.addStyleTag({
          content: `.report-page { border: 2px solid blue !important; } .report-content { border: 2px solid blue !important; } .print-footer { border: 2px solid red !important; }`,
        });
        await page.screenshot({ path: screenshotPath, fullPage: true });
      } catch (e) {
        console.warn('[ClientReportPDF] Debug screenshot/style injection failed', e?.message || e);
      }

      try {
        fs.writeFileSync(finalHtmlPath, await page.content());
      } catch (e) {
        console.warn('[ClientReportPDF] Failed to write final HTML content', e?.message || e);
      }

      try {
        if (debugStyle && typeof (debugStyle as any).evaluate === 'function') await debugStyle.evaluate((node: any) => node.parentNode?.removeChild(node));
      } catch (e) {
        // not critical
      }

      try {
        finalMeasured = await page.evaluate(() => {
          const footer = document.querySelector('.print-footer') as HTMLElement | null;
          const reportPage = document.querySelector('.report-page') as HTMLElement | null;
          const content = document.querySelector('.report-content') as HTMLElement | null;
          return {
            footerHeight: footer ? footer.getBoundingClientRect().height : 0,
            reportPageHeight: reportPage ? reportPage.scrollHeight : 0,
            contentHeight: content ? content.scrollHeight : 0,
          };
        });
      } catch (e) {
        console.warn('[ClientReportPDF] final measurement evaluate failed', e?.message || e);
      }

      console.log('[ClientReportPDF]', {
        reportId: String(reportId),
        initialHtmlPath,
        finalHtmlPath,
        screenshotPath,
        footerHeightPx: finalMeasured.footerHeight,
        calculatedBottomMarginMm: bottomMarginMm,
        reportPageHeightPx: finalMeasured.reportPageHeight,
        contentHeightPx: finalMeasured.contentHeight,
        pageBreakResult,
      });
    } catch (e: any) {
      // Defensive fallback if any DOM-evaluation step failed (for example due to page scripts).
      console.error('[ClientReportPDF] DOM evaluation failed, falling back to safe PDF render', {
        reportId: String(reportId),
        message: e?.message || String(e),
      });
      bottomMarginMm = 30;
      try {
        fs.writeFileSync(finalHtmlPath, await page.content());
      } catch {}
    }

    // Try to render PDF; if the first attempt fails, retry with a conservative fixed margin.
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', right: '12mm', bottom: `${bottomMarginMm}mm`, left: '12mm' },
      });
    } catch (e) {
      console.error('[ClientReportPDF] PDF render failed, retrying with fixed margin', { reportId: String(reportId), message: e?.message || String(e) });
      pdfBuffer = await page.pdf({ format: 'A4', printBackground: true, margin: { top: '10mm', right: '12mm', bottom: '30mm', left: '12mm' } });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(pdfBuffer.length));
    res.send(pdfBuffer);
  } catch (e: any) {
    console.error('[ClientReportPDF] Failed to render PDF', {
      reportId: String(reportId),
      message: e?.message || String(e),
    });
    if (!res.headersSent) {
      res.status(500).json({ message: e?.message || 'Failed to download PDF.' });
    }
  } finally {
    if (browser) await browser.close();
  }
};
