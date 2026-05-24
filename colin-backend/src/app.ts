import cors from 'cors';
import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'path';
import firmReportsRoutes from './routes/firmReports';
import authRoutes from './routes/auth';
import userRoutes from './routes/user.js';
import caseRoutes from './routes/case.js';
import taskRoutes from './routes/task.js';
import eventRoutes from './routes/event.js';
import documentRoutes from './routes/document.js';
import invoiceRoutes from './routes/invoice.js';
import auditRoutes from './routes/audit';
import calendarRoutes from './routes/calendar';
import billingRoutes from './routes/billing';
import auditFeedRoutes from './routes/auditFeed';
import pettyCashRoutes from './routes/pettyCash';
import notificationRoutes from './routes/notifications';
import timeLogRoutes from './routes/timeLogs';
import taskAttachmentsRoutes from './routes/taskAttachments';
import performanceRoutes from './routes/performance';
import clientReportRoutes from './routes/clientReports';
import dashboardRoutes from './routes/dashboard';
import adminEmailRoutes from './routes/adminEmail';
import helpRoutes from './routes/help';
import workflowRoutes from './routes/workflows';
import prospectRoutes from './routes/prospect';
const app = express();

// ✅ Allow multiple dev origins + configurable CLIENT_URL
const allowedOrigins = new Set(
  [
    process.env.CLIENT_URL,
    'http://localhost:3000',
    'http://localhost:5173',
    'https://app.colinandcolin.com', // Production frontend
  ].filter(Boolean) as string[]
);

// 1) CORS FIRST
app.use(
  cors({
    origin: (origin, callback) => {
      // allow non-browser clients like Postman/curl (no Origin header)
      if (!origin) return callback(null, true);

      if (allowedOrigins.has(origin)) return callback(null, true);

      return callback(new Error(`CORS blocked for origin: ${origin}`), false);
    },
    credentials: true,
  })
);

// 2) Body parsers
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// 3) Cookies
app.use(cookieParser());

// 4) Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/prospects', prospectRoutes);

app.use('/api', taskRoutes);
app.use('/api', eventRoutes);
app.use('/api', documentRoutes);
app.use('/api', invoiceRoutes);

app.use('/api', auditRoutes);
app.use('/api', auditFeedRoutes);

app.use('/api', calendarRoutes);
app.use('/api', billingRoutes);
app.use('/api', performanceRoutes);
app.use('/api', firmReportsRoutes);
app.use('/api/petty-cash', pettyCashRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/time-logs', timeLogRoutes);
app.use('/api', taskAttachmentsRoutes);
app.use('/api', clientReportRoutes);
app.use('/api', dashboardRoutes);
app.use('/api', adminEmailRoutes);
app.use('/api', helpRoutes);
app.use('/api/workflows', workflowRoutes);
// uploads
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// health
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;