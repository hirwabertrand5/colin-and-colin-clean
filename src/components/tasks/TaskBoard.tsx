/**
 * Task Management.
 *
 * The whole matter is one task now: all work happens in the Case Management tab
 * of the Case Workspace. This board therefore summarises the Case Management
 * state of every matter (workflow progress, current key action and deadline,
 * assigned members, open tasks/approvals, value and quality) and every card
 * opens that matter's Case Management tab.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckSquare, Clock, Search, Users } from 'lucide-react';
import { UserRole } from '../../App';
import { getAllTasks, TaskData } from '../../services/taskService';
import { CaseData, getAllCases, isTemporarilyClosedCase } from '../../services/caseService';
import usePageTitle from '../../hooks/usePageTitle';
import {
  formatDeadlineDateTime,
  formatDueCountdown,
  getDeadlinePillClass,
} from '../../utils/workflowDeadline';
import { getCasePracticePath } from '../../utils/caseLabels';
import { buildCaseManagementLink } from '../../utils/caseWorkspaceLinks';

interface TaskBoardProps {
  userRole: UserRole;
}

type BoardColumnId = 'Not Started' | 'Awaiting Review' | 'In Progress' | 'Completed';

const BOARD_COLUMNS: BoardColumnId[] = ['Not Started', 'Awaiting Review', 'In Progress', 'Completed'];

type MatterCard = {
  caseData: CaseData;
  openTasks: TaskData[];
  pendingApprovals: number;
  nextTaskDueDate?: string;
  column: BoardColumnId;
  keyActionsDone: number;
  keyActionsTotal: number;
  sectionsDone: number;
  sectionsTotal: number;
  currentStepTitle: string;
  currentStepDueAt?: string;
  currentStepStartAt?: string;
  isOverdue: boolean;
  searchIndex: string;
};

const isAssociateLike = (role: UserRole) =>
  role === 'associate' || role === 'trainee_associate' || role === 'senior_associate' || role === 'intern';

const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();

const toDate = (value?: string | Date) => {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
};

const formatMoney = (amount?: number, currency?: string) =>
  typeof amount === 'number' && Number.isFinite(amount)
    ? `${currency || 'RWF'} ${Math.round(amount).toLocaleString('en-US')}`
    : '—';

const memberList = (caseData: CaseData) =>
  [caseData.caseAssignments?.initiator, caseData.caseAssignments?.reviewer, caseData.caseAssignments?.signerApprover]
    .map((name) => String(name || '').trim())
    .filter(Boolean);

export default function TaskBoard({ userRole }: TaskBoardProps) {
  usePageTitle('Task Management');

  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPriority, setFilterPriority] = useState<'all' | 'High' | 'Medium' | 'Low'>('all');
  const [filterColumn, setFilterColumn] = useState<'all' | BoardColumnId>('all');

  const [tasks, setTasks] = useState<TaskData[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const [tasksData, casesData] = await Promise.all([getAllTasks(), getAllCases()]);
        setTasks(tasksData);
        setCases(casesData);
      } catch (err: any) {
        setError(err.message || 'Failed to load the task management list');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const getPriorityPill = (priority?: string) => {
    if (priority === 'High') return 'bg-red-50 text-red-700 border border-red-100';
    if (priority === 'Medium') return 'bg-yellow-50 text-yellow-800 border border-yellow-100';
    if (priority === 'Low') return 'bg-green-50 text-green-700 border border-green-100';
    return 'bg-gray-50 text-gray-700 border border-gray-100';
  };

  const getCaseStatusPill = (status?: string) => {
    const value = normalize(status);
    if (value === 'closed') return 'bg-gray-900 text-white border border-gray-900';
    if (value === 'temporarily closed') return 'bg-orange-50 text-orange-700 border border-orange-100';
    if (value === 'on boarding' || value === 'not started') return 'bg-gray-50 text-gray-700 border border-gray-200';
    return 'bg-blue-50 text-blue-700 border border-blue-100';
  };

  // Each card mirrors the Case Management tab of its matter, built from the
  // case record (workflow progress, team, value, quality) plus its tasks
  // (open work and approval queue) — no per-matter requests needed.
  const matterCards = useMemo<MatterCard[]>(() => {
    const tasksByCase = new Map<string, TaskData[]>();
    for (const task of tasks) {
      const key = String(task.caseId || '');
      if (!key) continue;
      const list = tasksByCase.get(key) || [];
      list.push(task);
      tasksByCase.set(key, list);
    }

    const now = Date.now();
    const cards: MatterCard[] = [];

    for (const caseData of cases) {
      if (!caseData._id) continue;
      const caseId = String(caseData._id);
      const caseTasks = tasksByCase.get(caseId) || [];
      const openTasks = caseTasks.filter(
        (task) => !['completed', 'closed'].includes(normalize(task.status || task.workflowStage))
      );
      const pendingApprovals = openTasks.filter(
        (task) => task.requiresApproval && normalize(task.approvalStatus) === 'pending'
      ).length;
      const nextTaskDue = openTasks
        .map((task) => toDate(task.dueDate))
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => a.getTime() - b.getTime())[0];

      const stageRows: any[] = Array.isArray((caseData as any)?.workflowProgress?.stagePercent)
        ? ((caseData as any).workflowProgress.stagePercent as any[])
        : [];
      const keyActionsTotal = stageRows.reduce((sum, row) => sum + (Number(row?.totalSteps) || 0), 0);
      const keyActionsDone = stageRows.reduce((sum, row) => sum + (Number(row?.completedSteps) || 0), 0);
      const sectionsTotal = stageRows.length;
      const sectionsDone = stageRows.filter(
        (row) => Number(row?.totalSteps) > 0 && Number(row?.completedSteps) >= Number(row?.totalSteps)
      ).length;

      const workflowStatus = String(caseData.workflowProgress?.status || '').trim();
      const caseClosed = normalize(caseData.status) === 'closed' || workflowStatus === 'Completed';
      const column: BoardColumnId = caseClosed
        ? 'Completed'
        : pendingApprovals > 0
          ? 'Awaiting Review'
          : workflowStatus && workflowStatus !== 'Not Started'
            ? 'In Progress'
            : 'Not Started';

      const currentStepDueAt = caseData.workflowProgress?.currentStepDueAt || caseData.workflowProgress?.nextDueAt;
      const dueDate = toDate(currentStepDueAt);
      const currentStepTitle = String(
        caseData.workflowProgress?.currentStepTitle || (caseClosed ? 'Matter workflow completed' : '')
      ).trim();

      cards.push({
        caseData,
        openTasks,
        pendingApprovals,
        ...(nextTaskDue ? { nextTaskDueDate: nextTaskDue.toISOString() } : {}),
        column,
        keyActionsDone,
        keyActionsTotal,
        sectionsDone,
        sectionsTotal,
        currentStepTitle,
        ...(currentStepDueAt ? { currentStepDueAt } : {}),
        ...(caseData.workflowProgress?.currentStepStartAt
          ? { currentStepStartAt: caseData.workflowProgress.currentStepStartAt }
          : {}),
        isOverdue: Boolean(dueDate && dueDate.getTime() < now && !caseClosed),
        searchIndex: [
          caseData.caseNo,
          caseData.parties,
          caseData.workflow,
          caseData.matterType,
          caseData.caseType,
          currentStepTitle,
          getCasePracticePath(caseData),
          ...memberList(caseData),
          ...caseTasks.map((task) => `${task.title} ${task.assignee || ''} ${task.supervisor || ''}`),
        ]
          .join(' ')
          .toLowerCase(),
      });
    }

    return cards.sort((a, b) => {
      if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
      const aDue = toDate(a.currentStepDueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      const bDue = toDate(b.currentStepDueAt)?.getTime() ?? Number.MAX_SAFE_INTEGER;
      if (aDue !== bDue) return aDue - bDue;
      return String(b.caseData.updatedAt || '').localeCompare(String(a.caseData.updatedAt || ''));
    });
  }, [cases, tasks]);

  const statusOptions = useMemo(() => {
    const values = new Set<string>();
    cases.forEach((caseData) => {
      const status = String(caseData.status || '').trim();
      if (status) values.add(status);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [cases]);

  const filteredCards = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    return matterCards.filter((card) => {
      const matchesSearch = !term || card.searchIndex.includes(term);
      const matchesStatus = filterStatus === 'all' || String(card.caseData.status || '') === filterStatus;
      const matchesPriority = filterPriority === 'all' || String(card.caseData.priority || '') === filterPriority;
      const matchesColumn = filterColumn === 'all' || card.column === filterColumn;
      return matchesSearch && matchesStatus && matchesPriority && matchesColumn;
    });
  }, [matterCards, searchTerm, filterStatus, filterPriority, filterColumn]);

  const counts = useMemo(() => {
    const result: Record<BoardColumnId, number> = {
      'Not Started': 0,
      'Awaiting Review': 0,
      'In Progress': 0,
      Completed: 0,
    };
    matterCards.forEach((card) => {
      result[card.column] += 1;
    });
    return result;
  }, [matterCards]);

  const overdueCount = matterCards.filter((card) => card.isOverdue).length;
  const pendingApprovalMatters = matterCards.filter((card) => card.pendingApprovals > 0).length;
  const activeMatterCount = matterCards.filter(
    (card) => card.column !== 'Completed' && !isTemporarilyClosedCase(card.caseData)
  ).length;

  const headerSubtitle =
    userRole === 'managing_director'
      ? 'Every matter and its Case Management state — open a card to work in the Case Management tab'
      : isAssociateLike(userRole)
        ? 'Your matters and their Case Management state — open a card to work in the Case Management tab'
        : 'Matter coordination and Case Management tracking';


  const renderCard = (card: MatterCard) => {
    const { caseData } = card;
    // Single-currency policy: always display RWF (amounts are never converted).
    const currency = 'RWF' as const;
    const percent = Math.max(0, Math.min(100, Number(caseData.workflowProgress?.percent) || 0));
    const matterLabel = caseData.workflow || caseData.matterType || caseData.caseType || 'Matter';
    const practicePath = getCasePracticePath(caseData);
    const dueAt = card.currentStepDueAt;
    const duePill = dueAt ? getDeadlinePillClass(dueAt, card.currentStepStartAt || caseData.createdAt) : '';
    const qualityScore = caseData.caseManagement?.qualityScore;
    const members = memberList(caseData);

    return (
      <Link
        key={String(caseData._id)}
        to={buildCaseManagementLink(caseData._id)}
        className="block border border-gray-200 rounded-xl p-4 bg-white hover:shadow-sm transition"
        title="Open the Case Management tab of this matter"
      >
        <div className="flex items-center justify-between gap-3 mb-2">
          <span className="text-xs font-semibold text-gray-500">{caseData.caseNo || 'Matter'}</span>
          <span className={`px-2 py-0.5 text-[11px] rounded-full ${getCaseStatusPill(caseData.status)}`}>
            {caseData.status || '—'}
          </span>
        </div>

        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className={`px-2 py-0.5 text-xs rounded ${getPriorityPill(caseData.priority)}`}>
            {caseData.priority || '—'}
          </span>
          <span className="px-2 py-0.5 text-xs rounded bg-slate-100 text-slate-700 border border-slate-200">
            {matterLabel}
          </span>
          {card.pendingApprovals > 0 && (
            <span className="px-2 py-0.5 text-xs rounded bg-amber-50 text-amber-700 border border-amber-100">
              {card.pendingApprovals} awaiting review
            </span>
          )}
        </div>

        <div className="text-sm font-semibold text-gray-900 mb-1 line-clamp-2">
          {caseData.parties || 'Parties not set'}
        </div>
        <div className="text-xs text-gray-500 mb-3 truncate" title={practicePath}>
          {practicePath}
        </div>

        <div className="mb-1 flex items-center justify-between text-xs text-gray-600">
          <span>Case Management progress</span>
          <span className="font-semibold text-gray-900">{percent}%</span>
        </div>
        <div className="mb-3 h-2 rounded-full bg-gray-100">
          <div className="h-2 rounded-full bg-gray-900" style={{ width: `${percent}%` }} />
        </div>


        <div className="grid grid-cols-1 gap-1.5 text-xs text-gray-600">
          <div className="flex items-start justify-between gap-3">
            <span className="truncate">
              <span className="text-gray-400">Current key action: </span>
              {card.currentStepTitle || '—'}
            </span>
            {dueAt ? (
              <span className={`shrink-0 rounded px-1.5 py-0.5 ${duePill}`} title={`Due ${formatDeadlineDateTime(dueAt)}`}>
                {formatDueCountdown(dueAt)}
              </span>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">
              <span className="text-gray-400">Key actions: </span>
              {card.keyActionsTotal > 0 ? `${card.keyActionsDone}/${card.keyActionsTotal} checked` : '—'}
            </span>
            <span className="shrink-0">
              <span className="text-gray-400">Sections: </span>
              {card.sectionsTotal > 0 ? `${card.sectionsDone}/${card.sectionsTotal}` : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">
              <span className="text-gray-400">Open tasks: </span>
              {card.openTasks.length}
            </span>
            <span className="shrink-0 truncate">
              <span className="text-gray-400">Next due: </span>
              {card.nextTaskDueDate ? formatDeadlineDateTime(card.nextTaskDueDate) : '—'}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="truncate">
              <span className="text-gray-400">Value: </span>
              {formatMoney(caseData.workflowProgress?.completedValue?.amount, currency)} of{' '}
              {formatMoney(caseData.workflowProgress?.plannedValue?.amount, currency)}
            </span>
            {qualityScore != null && (
              <span className="shrink-0 rounded-full border border-purple-100 bg-purple-50 px-2 py-0.5 text-[11px] font-semibold text-purple-700">
                Quality {qualityScore}%
              </span>
            )}
          </div>
        </div>

        <div className="mt-3 border-t border-gray-100 pt-2.5">
          <div className="flex items-center gap-1.5 text-[11px] text-gray-500">
            <Users className="w-3 h-3 shrink-0" />
            <span className="truncate" title={members.join(' · ')}>
              {members.length ? members.join(' · ') : 'No initiator / reviewer / approver set'}
            </span>
          </div>
          <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-gray-900">
            Open Case Management →
          </div>
        </div>
      </Link>
    );
  };


  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900 mb-1">Task Management</h1>
        <p className="text-gray-600">{headerSubtitle}</p>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">{error}</div>
      )}

      <div className="mb-6 flex flex-col xl:flex-row gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search matter, client, matter type, key action, member, task..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none"
          />
        </div>

        <select
          value={filterColumn}
          onChange={(e) => setFilterColumn(e.target.value as any)}
          className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none"
        >
          <option value="all">All Case Management states</option>
          {BOARD_COLUMNS.map((column) => (
            <option key={column} value={column}>
              {column}
            </option>
          ))}
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none"
        >
          <option value="all">All matter statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>

        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value as any)}
          className="px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-gray-400 focus:outline-none"
        >
          <option value="all">All priorities</option>
          <option value="High">High</option>
          <option value="Medium">Medium</option>
          <option value="Low">Low</option>
        </select>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">Loading matters...</div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {BOARD_COLUMNS.map((column) => {
              const columnCards = filteredCards.filter((card) => card.column === column);

              return (
                <div key={column} className="bg-white border border-gray-200 rounded-lg">
                  <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="font-semibold text-gray-900">{column}</h3>
                    <span className="px-2 py-1 text-xs rounded border border-gray-200 bg-gray-50 text-gray-700">
                      {columnCards.length}
                    </span>
                  </div>

                  <div className="p-4 space-y-3 min-h-[220px]">
                    {columnCards.length === 0 ? (
                      <div className="text-sm text-gray-400 text-center py-10">No matters</div>
                    ) : (
                      columnCards.map((card) => renderCard(card))
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-2xl font-semibold text-gray-900">{activeMatterCount}</div>
              <div className="text-sm text-gray-600">Active matters</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="text-2xl font-semibold text-gray-900">{counts['In Progress']}</div>
              <div className="text-sm text-gray-600">In progress</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <AlertTriangle className={`w-4 h-4 ${overdueCount ? 'text-red-600' : 'text-gray-400'}`} />
                <div className="text-2xl font-semibold text-gray-900">{overdueCount}</div>
              </div>
              <div className="text-sm text-gray-600">Matters past the current key action deadline</div>
            </div>
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <div className="flex items-center gap-2">
                <CheckSquare className={`w-4 h-4 ${pendingApprovalMatters ? 'text-amber-600' : 'text-gray-400'}`} />
                <div className="text-2xl font-semibold text-gray-900">{pendingApprovalMatters}</div>
              </div>
              <div className="text-sm text-gray-600">Matters awaiting review / approval</div>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <Clock className="w-3 h-3" /> Cards follow the Case Management state of each matter.
            </span>
            <Link to="/matters" className="text-gray-700 hover:text-gray-900">
              Browse all matters →
            </Link>
          </div>
        </>
      )}
    </div>
  );
}


