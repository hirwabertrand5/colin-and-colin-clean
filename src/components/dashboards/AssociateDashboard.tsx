import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  Briefcase,
  Calendar as CalendarIcon,
  CheckCircle2,
  CheckSquare,
  Clock,
  DollarSign,
  Handshake,
  ShieldAlert,
  TrendingUp,
  Users,
} from 'lucide-react';
import { UserRole } from '../../App';
import usePageTitle from '../../hooks/usePageTitle';
import { getAllCases, CaseData } from '../../services/caseService';
import { getFirmEvents, FirmCalendarEvent } from '../../services/eventService';
import { getMyPerformance, PerformanceSummary } from '../../services/performanceService';
import { getAllProspects, Prospect } from '../../services/prospectService';
import { getAllTasks, TaskData } from '../../services/taskService';

type Tone = 'slate' | 'green' | 'amber' | 'red' | 'blue' | 'purple';
type FinancialScope = 'own' | 'matter' | 'portfolio' | 'client';

type RoleProfile = {
  title: string;
  purpose: string;
  tpa: number;
  financialScope: FinancialScope;
  visible: {
    team: boolean;
    business: boolean;
    development: boolean;
    matterFinancials: boolean;
  };
  labels: {
    overview: string;
    matters: string;
    team: string;
    performance: string;
    development: string;
    earnings: string;
    risk: string;
  };
};

type StatCard = {
  label: string;
  value: string;
  helper?: string;
  icon: React.ComponentType<any>;
  tone?: Tone;
  href?: string;
};

type MatterRow = CaseData & {
  progress: number;
  contractValue: number;
  earnedValue: number;
  nextDeadline: string;
  openTasks: number;
  warningTasks: number;
  poorTasks: number;
};

type TeamRow = {
  name: string;
  assigned: number;
  completed: number;
  overdue: number;
  capacity: number;
  quality: number | null;
};

const partnerRoles: UserRole[] = [
  'senior_partner',
  'partner',
  'executive_partner',
  'associate_partner',
  'executive_associate_partner',
  'originating_attorney',
];

const roleProfiles: Record<string, RoleProfile> = {
  intern: {
    title: 'Intern Dashboard',
    purpose: 'Read-and-act dashboard for assigned work, matter support, learning, reviews, and own earnings.',
    tpa: 1,
    financialScope: 'own',
    visible: { team: false, business: false, development: true, matterFinancials: false },
    labels: {
      overview: 'My Work',
      matters: 'My Matters',
      team: 'Team Workload',
      performance: 'My Performance',
      development: 'Learning & Development',
      earnings: 'My Earnings',
      risk: 'Notifications & Deadline Alerts',
    },
  },
  trainee_associate: {
    title: 'Trainee Associate Dashboard',
    purpose: 'Execute work, develop professional competence, and take growing matter responsibility.',
    tpa: 3,
    financialScope: 'own',
    visible: { team: false, business: false, development: true, matterFinancials: false },
    labels: {
      overview: 'My Work',
      matters: 'My Matters',
      team: 'Team Workload',
      performance: 'Performance',
      development: 'Professional Development',
      earnings: 'My Financial Contribution',
      risk: 'Risk & Notifications',
    },
  },
  associate: {
    title: 'Associate Dashboard',
    purpose: 'Manage work, matters, quality, productivity, capacity, and authorised financial contribution.',
    tpa: 5,
    financialScope: 'matter',
    visible: { team: true, business: true, development: true, matterFinancials: true },
    labels: {
      overview: 'My Overview',
      matters: 'Matter Portfolio',
      team: 'Team Workload',
      performance: 'Performance',
      development: 'Professional Development',
      earnings: 'My Remuneration',
      risk: 'Risk & Compliance',
    },
  },
  senior_associate: {
    title: 'Senior Associate Dashboard',
    purpose: 'Manage matters, supervise people, control quality, control delivery, and protect profitability.',
    tpa: 6,
    financialScope: 'portfolio',
    visible: { team: true, business: true, development: true, matterFinancials: true },
    labels: {
      overview: 'Senior Associate Overview',
      matters: 'Matter Portfolio',
      team: 'Team Workload',
      performance: 'Team Performance',
      development: 'Quality Control',
      earnings: 'Remuneration',
      risk: 'Senior Associate Alerts',
    },
  },
  partner: {
    title: 'Partner Dashboard',
    purpose: 'Manage clients, matters, revenue, profitability, team delivery, and business development.',
    tpa: 8,
    financialScope: 'client',
    visible: { team: true, business: true, development: true, matterFinancials: true },
    labels: {
      overview: 'Partner Overview',
      matters: 'Client & Matter Portfolio',
      team: 'Team Management',
      performance: 'Team Management',
      development: 'Client Relationship Control',
      earnings: 'Partner Remuneration',
      risk: 'Partner Alerts',
    },
  },
};

const profileForRole = (role?: UserRole) => {
  if (role && roleProfiles[role]) return roleProfiles[role];
  if (role && partnerRoles.includes(role)) return roleProfiles.partner;
  if (role === 'senior_executive_assistant') return roleProfiles.senior_associate;
  return roleProfiles.associate;
};

const roleLabel = (role?: string) =>
  String(role || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const isoToday = () => new Date().toISOString().slice(0, 10);

const addDaysISO = (baseISO: string, days: number) => {
  const d = new Date(`${baseISO}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const safeNum = (value: unknown) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value || '').replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
};

const formatRwf = (value: number) => `RWF ${Math.round(value).toLocaleString('en-US')}`;

const normalizeName = (value: unknown) => String(value || '').trim().toLowerCase();

const getMatterContractValue = (matter: CaseData) => {
  const planned = safeNum(matter.workflowProgress?.plannedValue?.amount);
  const budget = safeNum(matter.budget);
  return planned > 0 ? planned : budget;
};

const getMatterEarnedValue = (matter: CaseData) => {
  const completed = safeNum(matter.workflowProgress?.completedValue?.amount);
  if (completed > 0) return completed;
  const contractValue = getMatterContractValue(matter);
  const progress = safeNum(matter.workflowProgress?.percent);
  if (contractValue > 0 && progress > 0) return Math.round((contractValue * progress) / 100);
  return safeNum(matter.billingSettings?.accruedUnbilled);
};

const getTaskDate = (raw?: string) => {
  if (!raw) return null;
  const parsed = new Date(raw.length <= 10 ? `${raw}T00:00:00` : raw);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const getConsumedPercent = (task: TaskData, todayISO: string) => {
  const start = getTaskDate(task.startDate || task.createdAt) || getTaskDate(task.dueDate);
  const due = getTaskDate(task.dueDate);
  const reference =
    task.status === 'Completed'
      ? getTaskDate(task.completedAt || task.updatedAt) || due
      : getTaskDate(`${todayISO}T23:59:59`);

  if (!start || !due || !reference) return 0;
  const total = due.getTime() - start.getTime();
  if (!Number.isFinite(total) || total <= 0) return reference.getTime() <= due.getTime() ? 50 : 101;
  return Math.round(((reference.getTime() - start.getTime()) / total) * 1000) / 10;
};

const getTimelinessBand = (task: TaskData, todayISO: string) => {
  if (task.status !== 'Completed' && task.dueDate < todayISO) return 'late';
  const consumed = getConsumedPercent(task, todayISO);
  if (consumed <= 25) return 'excellent';
  if (consumed <= 50) return 'good';
  if (consumed <= 75) return 'warning';
  if (consumed <= 100) return 'poor';
  return 'late';
};

const getTimelinessScore = (task: TaskData, todayISO: string) => Math.max(0, Math.round(100 - getConsumedPercent(task, todayISO)));

const toneClasses: Record<Tone, { icon: string; text: string; chip: string; bar: string }> = {
  slate: { icon: 'bg-gray-100 text-gray-700', text: 'text-gray-900', chip: 'bg-gray-100 text-gray-700', bar: 'bg-gray-700' },
  green: { icon: 'bg-green-100 text-green-700', text: 'text-green-700', chip: 'bg-green-100 text-green-700', bar: 'bg-green-600' },
  amber: { icon: 'bg-yellow-100 text-yellow-700', text: 'text-amber-700', chip: 'bg-yellow-100 text-yellow-700', bar: 'bg-yellow-500' },
  red: { icon: 'bg-red-100 text-red-700', text: 'text-red-700', chip: 'bg-red-100 text-red-700', bar: 'bg-red-600' },
  blue: { icon: 'bg-blue-100 text-blue-700', text: 'text-blue-700', chip: 'bg-blue-100 text-blue-700', bar: 'bg-blue-600' },
  purple: { icon: 'bg-purple-100 text-purple-700', text: 'text-purple-700', chip: 'bg-purple-100 text-purple-700', bar: 'bg-purple-600' },
};

const priorityChip = (priority: string) => {
  if (priority === 'High') return 'bg-red-100 text-red-700';
  if (priority === 'Medium') return 'bg-yellow-400 text-black';
  if (priority === 'Low') return 'bg-green-100 text-green-700';
  return 'bg-gray-100 text-gray-700';
};

function StatCardView({ stat, loading }: { stat: StatCard; loading: boolean }) {
  const Icon = stat.icon;
  const tone = toneClasses[stat.tone || 'slate'];
  const card = (
    <div className="h-full bg-white border border-gray-200 rounded-lg p-5">
      <div className={`mb-3 flex h-10 w-10 items-center justify-center rounded-lg ${tone.icon}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className={`text-2xl font-semibold ${loading ? 'text-gray-900' : tone.text}`}>{loading ? '…' : stat.value}</div>
      <div className="mt-1 text-sm text-gray-600">{stat.label}</div>
      {stat.helper ? <div className="mt-2 text-xs text-gray-500">{stat.helper}</div> : null}
    </div>
  );

  return stat.href ? (
    <Link to={stat.href} className="block h-full hover:shadow-sm">
      {card}
    </Link>
  ) : (
    card
  );
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-4">
      <h2 className="font-semibold text-gray-900">{title}</h2>
      <p className="mt-1 text-sm text-gray-500">{description}</p>
    </div>
  );
}

export default function AssociateDashboard({ userRole }: { userRole?: UserRole }) {
  const me = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem('user') || 'null') as { id: string; name: string; email: string; role: UserRole } | null;
    } catch {
      return null;
    }
  }, []);

  const effectiveRole = userRole || me?.role || 'associate';
  const profile = useMemo(() => profileForRole(effectiveRole), [effectiveRole]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [events, setEvents] = useState<FirmCalendarEvent[]>([]);
  const [performance, setPerformance] = useState<PerformanceSummary | null>(null);
  const [prospects, setProspects] = useState<Prospect[]>([]);

  usePageTitle(profile.title);

  const today = useMemo(() => isoToday(), []);
  const next30Days = useMemo(() => addDaysISO(today, 30), [today]);
  const meName = useMemo(() => normalizeName(me?.name), [me?.name]);

  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        setLoading(true);
        setError('');

        const [taskResult, caseResult, eventResult, performanceResult, prospectResult] = await Promise.allSettled([
          getAllTasks(),
          getAllCases(),
          getFirmEvents({ from: today, to: next30Days, type: 'all' }),
          getMyPerformance(),
          getAllProspects({ includeTerminal: true }),
        ]);

        if (!mounted) return;
        if (taskResult.status === 'fulfilled') setTasks(taskResult.value);
        if (caseResult.status === 'fulfilled') setCases(caseResult.value);
        if (eventResult.status === 'fulfilled') setEvents(eventResult.value);
        if (performanceResult.status === 'fulfilled') setPerformance(performanceResult.value);
        if (prospectResult.status === 'fulfilled') setProspects(prospectResult.value);
      } catch (e: any) {
        if (!mounted) return;
        setError(e?.message || 'Failed to load dashboard.');
      } finally {
        if (!mounted) return;
        setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [next30Days, today]);

  const visibleCaseIds = useMemo(() => new Set(tasks.map((task) => String(task.caseId || '')).filter(Boolean)), [tasks]);

  const authorisedCases = useMemo(() => {
    const scoped = cases.filter((matter) => {
      const assignedTo = normalizeName(matter.assignedTo);
      return visibleCaseIds.has(String(matter._id || '')) || (meName && assignedTo === meName);
    });
    return scoped.length > 0 ? scoped : cases;
  }, [cases, meName, visibleCaseIds]);

  const tasksByCase = useMemo(() => {
    const map = new Map<string, TaskData[]>();
    tasks.forEach((task) => {
      const caseId = String(task.caseId || '');
      if (!caseId) return;
      map.set(caseId, [...(map.get(caseId) || []), task]);
    });
    return map;
  }, [tasks]);

  const taskSignals = useMemo(() => {
    const open = tasks.filter((task) => task.status !== 'Completed');
    const completed = tasks.filter((task) => task.status === 'Completed');
    const dueSoon = open.filter((task) => task.dueDate >= today && task.dueDate <= addDaysISO(today, 7));
    const overdue = open.filter((task) => task.dueDate < today || getTimelinessBand(task, today) === 'late');
    const awaitingReview = tasks.filter(
      (task) => task.workflowStage === 'Awaiting Review' || (task.requiresApproval && task.approvalStatus === 'Pending')
    );
    const awaitingExternal = tasks.filter((task) => task.workflowStage === 'Awaiting External Action');
    const bandCounts = tasks.reduce(
      (acc, task) => {
        acc[getTimelinessBand(task, today)] += 1;
        return acc;
      },
      { excellent: 0, good: 0, warning: 0, poor: 0, late: 0 } as Record<string, number>
    );
    const scoredQuality = tasks.filter((task) => Number.isFinite(Number(task.qualityScore)));
    const qualityAverage =
      performance?.averageQualityScore != null
        ? Math.round(performance.averageQualityScore)
        : scoredQuality.length
          ? Math.round(scoredQuality.reduce((sum, task) => sum + safeNum(task.qualityScore), 0) / scoredQuality.length)
          : null;
    const timelinessAverage =
      performance?.averageTimelinessScore != null
        ? Math.round(performance.averageTimelinessScore)
        : tasks.length
          ? Math.round(tasks.reduce((sum, task) => sum + getTimelinessScore(task, today), 0) / tasks.length)
          : 0;
    const onTimeRate = performance?.onTimeCompletionPct ?? 0;
    const completionRate = performance?.tasksTotal
      ? Math.round((performance.tasksCompleted / performance.tasksTotal) * 100)
      : tasks.length
        ? Math.round((completed.length / tasks.length) * 100)
        : 0;

    return { open, completed, dueSoon, overdue, awaitingReview, awaitingExternal, bandCounts, qualityAverage, timelinessAverage, onTimeRate, completionRate };
  }, [performance?.averageQualityScore, performance?.averageTimelinessScore, performance?.onTimeCompletionPct, performance?.tasksCompleted, performance?.tasksTotal, tasks, today]);

  const matterRows = useMemo<MatterRow[]>(() => {
    return authorisedCases
      .map((matter) => {
        const matterTasks = tasksByCase.get(String(matter._id || '')) || [];
        const openTasks = matterTasks.filter((task) => task.status !== 'Completed');
        const nextDeadline = openTasks.map((task) => task.dueDate).filter(Boolean).sort()[0] || matter.workflowProgress?.nextDueAt || '—';
        const progress =
          safeNum(matter.workflowProgress?.percent) ||
          (matterTasks.length ? Math.round((matterTasks.filter((task) => task.status === 'Completed').length / matterTasks.length) * 100) : 0);
        const warningTasks = matterTasks.filter((task) => getTimelinessBand(task, today) === 'warning').length;
        const poorTasks = matterTasks.filter((task) => ['poor', 'late'].includes(getTimelinessBand(task, today))).length;

        return {
          ...matter,
          progress,
          contractValue: getMatterContractValue(matter),
          earnedValue: getMatterEarnedValue(matter),
          nextDeadline,
          openTasks: openTasks.length,
          warningTasks,
          poorTasks,
        };
      })
      .sort((a, b) => b.warningTasks + b.poorTasks - (a.warningTasks + a.poorTasks));
  }, [authorisedCases, tasksByCase, today]);

  const financials = useMemo(() => {
    const contractValue = matterRows.reduce((sum, matter) => sum + matter.contractValue, 0);
    const earnedValue = matterRows.reduce((sum, matter) => sum + matter.earnedValue, 0);
    const outstanding = Math.max(0, contractValue - earnedValue);
    const grossProfitMargin = earnedValue > 0 ? 100 : 0;
    return { contractValue, earnedValue, outstanding, grossProfitMargin };
  }, [matterRows]);

  const teamRows = useMemo<TeamRow[]>(() => {
    const map = new Map<string, { assigned: number; completed: number; overdue: number; quality: number[] }>();
    tasks.forEach((task) => {
      const name = String(task.assignee || 'Unassigned').trim() || 'Unassigned';
      const row = map.get(name) || { assigned: 0, completed: 0, overdue: 0, quality: [] };
      row.assigned += 1;
      if (task.status === 'Completed') row.completed += 1;
      if (task.status !== 'Completed' && task.dueDate < today) row.overdue += 1;
      if (Number.isFinite(Number(task.qualityScore))) row.quality.push(safeNum(task.qualityScore));
      map.set(name, row);
    });

    return Array.from(map.entries())
      .map(([name, row]) => ({
        name,
        assigned: row.assigned,
        completed: row.completed,
        overdue: row.overdue,
        capacity: Math.min(150, Math.round((row.assigned / 20) * 100)),
        quality: row.quality.length ? Math.round(row.quality.reduce((sum, value) => sum + value, 0) / row.quality.length) : null,
      }))
      .sort((a, b) => b.capacity - a.capacity || b.overdue - a.overdue)
      .slice(0, 8);
  }, [tasks, today]);

  const businessStats = useMemo(() => {
    const ownProspects = prospects.filter((prospect) => {
      if (!meName) return true;
      const assignedTo = typeof prospect.assignedTo === 'object' ? prospect.assignedTo?.name : prospect.assignedTo;
      const associate = typeof prospect.responsibleAssociate === 'object' ? prospect.responsibleAssociate?.name : prospect.responsibleAssociate;
      const partner = typeof prospect.responsiblePartner === 'object' ? prospect.responsiblePartner?.name : prospect.responsiblePartner;
      return [assignedTo, associate, partner].some((value) => normalizeName(value) === meName);
    });
    const open = ownProspects.filter((prospect) => !['Converted', 'Non-Converted'].includes(String(prospect.stage)));
    const converted = ownProspects.filter((prospect) => prospect.stage === 'Converted');
    const lost = ownProspects.filter((prospect) => prospect.stage === 'Non-Converted');
    const terminal = converted.length + lost.length;
    return {
      leads: ownProspects.length,
      opportunities: open.length,
      pipelineValue: open.reduce((sum, prospect) => sum + safeNum(prospect.estimatedFeeValue || prospect.estimatedMatterValue), 0),
      conversionRate: terminal ? Math.round((converted.length / terminal) * 100) : 0,
      newClients: converted.length,
      lostClients: lost.length,
    };
  }, [meName, prospects]);

  const upcomingEvents = useMemo(
    () => events.filter((event) => String(event.date) >= today).sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, 6),
    [events, today]
  );

  const headlineStats = useMemo<StatCard[]>(() => {
    const activeMatters = authorisedCases.filter((matter) => String(matter.status || '').toLowerCase() !== 'closed').length;
    const qualityFactor = (taskSignals.qualityAverage ?? 0) / 100;
    const feeEarnedSignal = Math.round(financials.earnedValue * (profile.tpa / 100) * (taskSignals.timelinessAverage / 100) * qualityFactor);
    const stats: StatCard[] = [
      { label: profile.financialScope === 'client' ? 'Active Clients / Matters' : 'Active Matters', value: String(activeMatters), helper: 'Uses linked matters from your task set', icon: Briefcase, tone: 'blue', href: '/matters' },
      { label: 'Tasks Outstanding', value: String(taskSignals.open.length), helper: `${taskSignals.dueSoon.length} due in 7 days`, icon: CheckSquare, tone: taskSignals.open.length ? 'amber' : 'green', href: '/tasks' },
      { label: 'Overdue Tasks', value: String(taskSignals.overdue.length), helper: taskSignals.overdue.length ? 'Action required' : 'No overdue work', icon: AlertTriangle, tone: taskSignals.overdue.length ? 'red' : 'green', href: '/tasks' },
      { label: 'On-Time Completion', value: `${taskSignals.onTimeRate}%`, helper: 'Matches productivity report', icon: Clock, tone: taskSignals.onTimeRate >= 80 ? 'green' : 'amber', href: '/performance' },
      { label: 'Quality Score', value: taskSignals.qualityAverage == null ? 'Pending' : `${taskSignals.qualityAverage}%`, helper: 'Matches productivity report', icon: Award, tone: 'purple', href: '/performance' },
      { label: 'Tasks Completed', value: String(performance?.tasksCompleted ?? taskSignals.completed.length), helper: `${taskSignals.completionRate}% completion rate`, icon: TrendingUp, tone: 'green', href: '/performance' },
      profile.financialScope === 'own'
        ? { label: 'TPA', value: `${profile.tpa}%`, helper: 'Role remuneration configuration', icon: DollarSign, tone: 'green' }
        : { label: profile.financialScope === 'client' ? 'Portfolio Contract Value' : 'Matter Contract Value', value: formatRwf(financials.contractValue), helper: 'Authorised matter values', icon: DollarSign, tone: 'green' },
      { label: 'Fee Earned Signal', value: feeEarnedSignal > 0 ? formatRwf(feeEarnedSignal) : 'Pending', helper: `Uses ${profile.tpa}% TPA × timeliness × quality`, icon: DollarSign, tone: feeEarnedSignal > 0 ? 'green' : 'amber' },
    ];
    return stats;
  }, [authorisedCases, financials, profile, taskSignals]);

  return (
    <div>
      <div className="mb-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500">{roleLabel(effectiveRole)}</div>
            <h1 className="mt-1 text-2xl font-semibold text-gray-900">{profile.title}</h1>
            <p className="mt-1 text-gray-600">{me?.name ? `Welcome, ${me.name}. ` : ''}{profile.purpose}</p>
          </div>
          <div className="rounded-full bg-gray-900 px-4 py-2 text-xs font-semibold text-white">
            TPA {profile.tpa}% · {profile.financialScope} scope
          </div>
        </div>
      </div>

      {error && <div className="mb-6 p-4 border border-red-200 bg-red-50 text-red-700 rounded">{error}</div>}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        {headlineStats.map((stat) => <StatCardView key={stat.label} stat={stat} loading={loading} />)}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <SectionHeader title={profile.labels.overview} description="Assigned work, timeliness bands, approval/review queues, and urgent actions." />
            <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
              {[
                ['🔵 Excellent', taskSignals.bandCounts.excellent, 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/30 dark:text-blue-200'],
                ['🟢 Good', taskSignals.bandCounts.good, 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200'],
                ['🟡 Warning', taskSignals.bandCounts.warning, 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200'],
                ['🔴 Poor', taskSignals.bandCounts.poor, 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-200'],
                ['Late', taskSignals.bandCounts.late, 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/50 dark:bg-red-950/30 dark:text-red-200'],
              ].map(([label, value, classes]) => (
                <div key={String(label)} className={`rounded-lg border px-3 py-2 text-sm ${classes}`}>
                  <div className="font-semibold">{loading ? '…' : value}</div>
                  <div className="text-xs">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading tasks…</div>
          ) : tasks.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">No tasks assigned.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {[...taskSignals.overdue, ...taskSignals.dueSoon, ...taskSignals.open]
                .filter((task, index, list) => list.findIndex((item) => item._id === task._id) === index)
                .slice(0, 8)
                .map((task) => (
                  <div key={String(task._id)} className="px-5 py-4 hover:bg-gray-50">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="mb-2 flex flex-wrap items-center gap-2">
                          <span className={`px-2 py-0.5 text-xs rounded ${priorityChip(task.priority)}`}>{task.priority}</span>
                          <span className="px-2 py-0.5 text-xs rounded bg-gray-100 text-gray-700">{task.status}</span>
                          {task.workflowStage ? <span className="px-2 py-0.5 text-xs rounded bg-blue-50 text-blue-700">{task.workflowStage}</span> : null}
                        </div>
                        <p className="text-sm font-medium text-gray-900">{task.title}</p>
                        <p className="mt-1 text-xs text-gray-500">Due {task.dueDate} · Supervisor {task.supervisor || '—'} · Timeliness {getTimelinessScore(task, today)}%</p>
                      </div>
                      <Link to={`/tasks/${task._id}`} className="shrink-0 px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">Open</Link>
                    </div>
                  </div>
                ))}
            </div>
          )}
          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/tasks" className="text-sm text-gray-600 hover:text-gray-900">View all tasks →</Link>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <SectionHeader title={profile.labels.risk} description="System-generated alerts from task status, deadlines, approvals, and calendar records." />
          <div className="space-y-3">
            {[
              { label: 'Awaiting review / approval', value: taskSignals.awaitingReview.length, icon: CheckCircle2, tone: 'amber' as Tone },
              { label: 'Awaiting client/external info', value: taskSignals.awaitingExternal.length, icon: Clock, tone: 'blue' as Tone },
              { label: 'Overdue or late work', value: taskSignals.overdue.length, icon: ShieldAlert, tone: taskSignals.overdue.length ? 'red' as Tone : 'green' as Tone },
              { label: 'Upcoming calendar items', value: upcomingEvents.length, icon: CalendarIcon, tone: 'slate' as Tone },
            ].map((item) => {
              const Icon = item.icon;
              const tone = toneClasses[item.tone];
              return (
                <div key={item.label} className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-3">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${tone.icon}`}><Icon className="h-4 w-4" /></div>
                    <div className="text-sm text-gray-700">{item.label}</div>
                  </div>
                  <div className={`font-semibold ${tone.text}`}>{loading ? '…' : item.value}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg">
          <div className="px-5 py-4 border-b border-gray-200">
            <SectionHeader title={profile.labels.matters} description="Role-permitted matters with next actions, deadlines, workload pressure, and drill-down." />
          </div>
          {loading ? (
            <div className="px-5 py-10 text-gray-500">Loading matters…</div>
          ) : matterRows.length === 0 ? (
            <div className="px-5 py-10 text-gray-500">No authorised matters found.</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {matterRows.slice(0, 8).map((matter) => (
                <div key={String(matter._id)} className="px-5 py-4 hover:bg-gray-50">
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium text-gray-900">{matter.caseNo || matter.parties}</h3>
                        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 text-xs rounded">{matter.status}</span>
                        <span className={`px-2 py-0.5 text-xs rounded ${priorityChip(matter.priority)}`}>{matter.priority}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">Client/parties: {matter.parties || '—'}</p>
                      <p className="mt-1 text-xs text-gray-500">Next action: {matter.workflowProgress?.currentStepTitle || 'Workflow task'} · Deadline {matter.nextDeadline}</p>
                    </div>
                    <div className="flex items-center gap-3 md:text-right">
                      <div>
                        <div className="text-xs text-gray-500">Open tasks</div>
                        <div className="font-semibold text-gray-900">{matter.openTasks}</div>
                      </div>
                      <Link to={`/matters/${matter._id}`} className="px-3 py-1 text-xs border border-gray-300 rounded hover:bg-gray-50">Open</Link>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
                      <span>Progress</span>
                      <span>{matter.progress}% · 🟡 {matter.warningTasks} · 🔴 {matter.poorTasks}</span>
                    </div>
                    <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gray-700" style={{ width: `${Math.min(100, matter.progress)}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="px-5 py-3 border-t border-gray-200">
            <Link to="/matters" className="text-sm text-gray-600 hover:text-gray-900">View all matters →</Link>
          </div>
        </div>

        {profile.visible.matterFinancials && (
          <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg p-5">
            <SectionHeader title="Matter Financial Status" description="Authorised matter values only; firm-wide revenue, firm cash, and firm profitability remain restricted." />
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                ['Contract Value', formatRwf(financials.contractValue), 'slate' as Tone],
                ['Work Value in Progress', formatRwf(financials.earnedValue), 'green' as Tone],
                ['Outstanding Value', formatRwf(financials.outstanding), 'amber' as Tone],
                ['Gross Margin Signal', `${financials.grossProfitMargin}%`, financials.grossProfitMargin > 0 ? 'green' as Tone : 'amber' as Tone],
              ].map(([label, value, tone]) => {
                const toneData = toneClasses[tone as Tone];
                return (
                  <div key={String(label)} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500">{label}</div>
                    <div className={`mt-2 text-lg font-semibold ${toneData.text}`}>{loading ? '…' : value}</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {profile.visible.team && (
          <div className="lg:col-span-2 bg-white border border-gray-200 rounded-lg p-5">
            <SectionHeader title={profile.labels.team} description="Assigned, completed, overdue, capacity, and quality for authorised team workload." />
            {loading ? (
              <div className="text-gray-500">Loading team workload…</div>
            ) : teamRows.length === 0 ? (
              <div className="text-gray-500">No team workload data available.</div>
            ) : (
              <div className="space-y-3">
                {teamRows.map((member) => {
                  const tone = member.capacity > 100 ? 'red' : member.capacity > 85 ? 'amber' : 'green';
                  return (
                    <div key={member.name} className="rounded-lg border border-gray-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-gray-900">{member.name}</div>
                          <div className="text-xs text-gray-500">{member.completed}/{member.assigned} completed · {member.overdue} overdue · quality {member.quality == null ? '—' : `${member.quality}%`}</div>
                        </div>
                        <div className={`text-sm font-semibold ${toneClasses[tone].text}`}>{member.capacity}%</div>
                      </div>
                      <div className="mt-3 h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div className={`h-full ${toneClasses[tone].bar}`} style={{ width: `${Math.min(100, member.capacity)}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="bg-white border border-gray-200 rounded-lg p-5">
          <SectionHeader title={profile.labels.performance} description="Completion, timeliness, quality, and performance rating from existing task/performance data." />
          <div className="space-y-4">
            {[
              ['Completion Rate', `${taskSignals.completionRate}%`, CheckSquare, taskSignals.completionRate >= 80 ? 'green' : 'amber'],
              ['Average Timeliness', `${taskSignals.timelinessAverage}%`, Clock, taskSignals.timelinessAverage >= 70 ? 'green' : 'amber'],
              ['Average Quality', taskSignals.qualityAverage == null ? 'Pending' : `${taskSignals.qualityAverage}%`, Award, 'purple'],
              ['Performance Rating', performance?.rating?.value ? `${performance.rating.value}/5` : 'Pending', BarChart3, 'blue'],
            ].map(([label, value, Icon, tone]) => {
              const toneData = toneClasses[tone as Tone];
              const IconComponent = Icon as React.ComponentType<any>;
              return (
                <div key={String(label)} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${toneData.icon}`}><IconComponent className="h-4 w-4" /></div>
                    <div className="text-sm text-gray-700">{label}</div>
                  </div>
                  <div className={`font-semibold ${toneData.text}`}>{loading ? '…' : String(value)}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 border-t border-gray-200 pt-3">
            <Link to="/performance" className="text-sm text-gray-600 hover:text-gray-900">Open detailed performance →</Link>
          </div>
        </div>

        {profile.visible.development && (
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <SectionHeader title={profile.labels.development} description="Development indicators reuse training, review, and performance sources when configured." />
            <div className="grid grid-cols-1 gap-3">
              {['Legal Skills', 'Drafting', 'Research', 'Client Communication', 'Training'].map((label) => (
                <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-gray-600" />
                    <div className="text-sm font-medium text-gray-900">{label}</div>
                  </div>
                  <div className="mt-1 text-xs text-gray-500">Uses authorised reviews/training data; no duplicate dashboard entry field.</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {profile.visible.business && (
          <div className="bg-white border border-gray-200 rounded-lg p-5">
            <SectionHeader title="Business Development" description="Limited CRM/prospect visibility tied to responsible staff, partner, or assignment." />
            <div className="grid grid-cols-2 gap-3">
              {[
                ['Leads/Prospects', businessStats.leads],
                ['Open Opportunities', businessStats.opportunities],
                ['Pipeline Value', formatRwf(businessStats.pipelineValue)],
                ['Conversion Rate', `${businessStats.conversionRate}%`],
                ['New Clients', businessStats.newClients],
                ['Lost Clients', businessStats.lostClients],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <Handshake className="mb-2 h-4 w-4 text-gray-600" />
                  <div className="text-lg font-semibold text-gray-900">{loading ? '…' : String(value)}</div>
                  <div className="text-xs text-gray-500">{label}</div>
                </div>
              ))}
            </div>
            <div className="mt-5 border-t border-gray-200 pt-3">
              <Link to="/matters/intake-prospects" className="text-sm text-gray-600 hover:text-gray-900">Open prospects →</Link>
            </div>
          </div>
        )}

        <div className="lg:col-span-3 bg-white border border-gray-200 rounded-lg p-5">
          <SectionHeader title={profile.labels.earnings} description="Own remuneration only, calculated from collected/work value, role TPA, timeliness, and quality." />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {[
              ['Task Fee Collected', formatRwf(financials.earnedValue), 'Billing/payment records and matter progress'],
              ['TPA', `${profile.tpa}%`, 'Configured from role/remuneration setup'],
              ['Timeliness Score', `${taskSignals.timelinessAverage}%`, 'Calculated from assignment, deadline, and completion'],
              ['Quality Score', taskSignals.qualityAverage == null ? 'Pending' : `${taskSignals.qualityAverage}%`, 'Approved task review score'],
            ].map(([label, value, helper]) => (
              <div key={label} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-500">{label}</div>
                <div className="mt-2 text-lg font-semibold text-gray-900">{loading ? '…' : value}</div>
                <div className="mt-1 text-xs text-gray-500">{helper}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg bg-gray-900 px-4 py-3 text-sm text-white">
            Fee Earned = Task Fee Collected × {profile.tpa}% × Timeliness Score × Quality Score
          </div>
        </div>
      </div>
    </div>
  );
}
