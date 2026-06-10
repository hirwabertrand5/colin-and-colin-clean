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
    @page { size: A4; margin: 10mm 12mm 22mm; }
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
  status: string;
  priority?: string;
  assignedTo?: string;
  description?: string;
  serviceRequested?: string;
  clientName?: string;
  clientEmail?: string;
  clientPhone?: string;
  reportKind: 'Weekly' | 'Monthly' | 'Manual';
  periodStart: Date;
  periodEnd: Date;

  updates: { createdAt: string; action?: string; message: string; detail?: string; actorName?: string }[];
  tasks: { title: string; status: string; assignee: string; dueDate?: string; priority?: string; description?: string }[];
  events: { title: string; type: string; date: string; time?: string; description?: string }[];
  documents: { name: string; uploadedDate: string; uploadedBy: string; category?: string; size?: string }[];
}) => {
  const logo = getLogoDataUri();
  const reportDate = displayDate(payload.periodEnd);
  const periodLabel = `${displayDate(payload.periodStart)} to ${displayDate(payload.periodEnd)}`;
  const upcomingEvents = payload.events.slice(0, 6);
  const pendingTasks = payload.tasks.filter((task) => task.status !== 'Completed').slice(0, 8);
  const completedTasks = payload.tasks.filter((task) => task.status === 'Completed').slice(0, 8);
  const nextAction = pendingTasks[0] || payload.tasks[0];
  const caseSummary =
    payload.description ||
    `This matter concerns ${payload.parties || 'the client matter'} and is currently at ${payload.status || 'the active stage'}.`;
  const serviceRequested = payload.serviceRequested || payload.caseType || 'Legal services';
  const workDoneItems = [
    ...completedTasks.map((task) => task.title),
    ...payload.updates.slice(0, 5).map((update) => update.message),
    ...payload.documents.slice(0, 3).map((doc) => `Reviewed or added document: ${doc.name}`),
  ].filter(Boolean);
  const milestoneItems = [
    ...pendingTasks.map((task) => `${task.title}${task.dueDate ? ` - due ${task.dueDate}` : ''}`),
    ...upcomingEvents.map((event) => `${event.title}${event.date ? ` - ${event.date}` : ''}`),
  ].filter(Boolean);

  const bulletList = (items: string[], emptyText: string) =>
    items.length
      ? `<ul class="report-list">${items.map((item) => `<li>${nl2br(item)}</li>`).join('')}</ul>`
      : `<p class="muted">${safe(emptyText)}</p>`;

  return `
  <style>
    .report-page { min-height: 100vh; padding: 0 4mm; position: relative; }
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
    .info-table { width: 100%; border-collapse: collapse; margin-top: 8px; table-layout: fixed; }
    .info-table td { border: 1px solid #777; vertical-align: top; padding: 8px 9px; }
    .info-table .label { width: 18%; font-weight: 700; background: #f3f3f3; }
    .info-table .value { width: 42%; }
    .info-table .side-label { width: 16%; font-weight: 700; background: #f3f3f3; }
    .info-table .side-value { width: 24%; }
    .section-box { border: 1px solid #777; padding: 10px 12px; margin: 8px 0 14px; min-height: 34px; }
    .split-row { display: grid; grid-template-columns: 1fr 150px; gap: 18px; align-items: start; }
    .report-list { margin: 0; padding-left: 18px; }
    .report-list li { margin: 4px 0; }
    .muted { color: #555; }
    .status-grid { display: grid; grid-template-columns: 150px 1fr; border: 1px solid #777; margin: 8px 0 14px; }
    .status-grid div { padding: 8px 10px; border-bottom: 1px solid #777; }
    .status-grid div:nth-last-child(-n + 2) { border-bottom: 0; }
    .status-grid .label { font-weight: 700; background: #f3f3f3; border-right: 1px solid #777; }
    .closing { margin-top: 22px; }
    .signature { margin-top: 22px; }
    .print-footer { position: fixed; left: 12mm; right: 12mm; bottom: 7mm; font-family: Arial, sans-serif; font-size: 8.3pt; color: #111; }
    .motto { text-align: center; font-weight: 700; letter-spacing: .3px; margin-bottom: 4px; }
    .footer-lines { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; border-top: 1px solid #333; padding-top: 4px; }
    .footer-lines div { line-height: 1.35; }
    @media screen {
      .print-footer { position: static; margin-top: 28px; }
    }
  </style>
  <div class="report-page">
    <div class="topline">
      <div>${logo ? `<img class="logo" src="${logo}" alt="Colin & Colin" />` : '<strong>COLIN & COLIN</strong>'}</div>
      <div class="date">Date: ${safe(reportDate)}</div>
    </div>

    <div class="client-block">
      <strong>${safe(payload.clientName || payload.parties || 'Client')}</strong><br/>
      Kigali, RWANDA${payload.clientPhone ? `<br/>Tel: ${safe(payload.clientPhone)}` : ''}${
        payload.clientEmail ? `<br/>Email: ${safe(payload.clientEmail)}` : ''
      }
    </div>

    <p class="salutation">Dear Sir/Madam,</p>
    <h1>UPDATE REPORT</h1>
    <p class="intro">
      We hereby present the updated progress report of the matters we are handling on behalf of
      ${safe(payload.clientName || payload.parties || 'you')}.
    </p>

    <h2>1. Case Information</h2>
    <table class="info-table">
      <tr>
        <td class="label">Case Summary</td>
        <td class="value" rowspan="4">${nl2br(caseSummary)}</td>
        <td class="side-label">Update Report Date</td>
        <td class="side-value">${safe(reportDate)}</td>
      </tr>
      <tr>
        <td class="label">Case Parties</td>
        <td class="side-label">Service Requested</td>
        <td class="side-value">${safe(serviceRequested)}</td>
      </tr>
      <tr>
        <td class="label">${safe(payload.parties)}</td>
        <td class="side-label">Partner & Associate In Charge</td>
        <td class="side-value">${safe(payload.assignedTo || 'Me. Colin GATETE')}</td>
      </tr>
      <tr>
        <td class="label">Case Number</td>
        <td class="side-label">Report Period</td>
        <td class="side-value">${safe(periodLabel)}</td>
      </tr>
      <tr>
        <td class="label">${safe(payload.caseNo || '-')}</td>
        <td class="value">${safe(payload.caseType)}</td>
        <td class="side-label">Report Type</td>
        <td class="side-value">${safe(payload.reportKind)} update</td>
      </tr>
    </table>

    <h2>2. Work Done</h2>
    <div class="section-box">${bulletList(workDoneItems.slice(0, 8), 'No work updates were recorded for this reporting period.')}</div>

    <h2>3. Next Action</h2>
    <div class="section-box split-row">
      <div>${nextAction ? nl2br(nextAction.title) : 'Continue following up on the matter and update the client once a material development occurs.'}</div>
      <div>${nextAction?.dueDate ? safe(nextAction.dueDate) : upcomingEvents[0]?.date ? safe(upcomingEvents[0].date) : '&nbsp;'}</div>
    </div>

    <h2>4. Upcoming Milestone</h2>
    <div class="section-box">${bulletList(milestoneItems.slice(0, 8), 'No upcoming milestone is currently scheduled.')}</div>

    <h2>5. Client Input And Decision</h2>
    <div class="section-box">
      <p class="muted">Client input, approval, instructions, or decision required will be recorded here when applicable.</p>
    </div>

    <h2>Case Overview</h2>
    <div class="status-grid">
      <div class="label">Overall Status</div><div>${safe(payload.status || 'Active')}</div>
      <div class="label">Priority</div><div>${safe(payload.priority || 'Medium')}</div>
      <div class="label">Case Number</div><div>${safe(payload.caseNo || '-')}</div>
    </div>

    <h2>Recent Development</h2>
    <div class="section-box">
      ${bulletList(
        payload.updates.slice(0, 8).map((u) => {
          const who = u.actorName ? ` - ${u.actorName}` : '';
          const detail = u.detail ? ` (${u.detail})` : '';
          return `${u.createdAt}${who}: ${u.message}${detail}`;
        }),
        'No recent developments were recorded in this period.'
      )}
    </div>

    <h2>Documents Added</h2>
    <div class="section-box">
      ${bulletList(
        payload.documents.slice(0, 8).map((doc) => `${doc.uploadedDate} - ${doc.name}${doc.uploadedBy ? `, uploaded by ${doc.uploadedBy}` : ''}`),
        'No documents were added during this reporting period.'
      )}
    </div>

    <div class="closing">
      <p>
        We want to reassure you that our team is actively and dedicatedly pursuing your case, aiming for the best
        possible outcome. Should you have any inquiries regarding the progress of your case or any related issues,
        please feel free to reach out to us.
      </p>
      <p>Thank you for choosing us to handle your legal matters. We value your ongoing cooperation and trust.</p>
    </div>

    <div class="signature">
      <p>Sincerely,</p>
      <p><strong>Colin & Colin Legal Solutions</strong></p>
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

    const subject = `${reportKind} Update Report - ${text(c.caseNo)} - ${text(c.parties)} - ${formatDate(periodEnd)}`;

    const html = buildHtml({
      caseNo: c.caseNo,
      parties: c.parties,
      caseType: c.caseType,
      status: c.status,
      priority: c.priority,
      assignedTo: c.assignedTo,
      description: c.description,
      serviceRequested,
      clientName: primaryContact.name || c.parties,
      clientEmail: primaryContact.email,
      clientPhone: primaryContact.phone,
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

  // Render PDF
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(htmlDoc, { waitUntil: 'networkidle' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', right: '12mm', bottom: '24mm', left: '12mm' },
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(pdfBuffer);
  } finally {
    await browser.close();
  }
};
