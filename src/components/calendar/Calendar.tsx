import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Search, Pencil, Trash2 } from 'lucide-react';
import { UserRole } from '../../App';
import usePageTitle from '../../hooks/usePageTitle';
import {
  addEventToCase,
  deleteEvent,
  getFirmEvents,
  getCalendarTasks,
  updateEvent,
  FirmCalendarEvent,
  CalendarTask,
} from '../../services/eventService';
import { getAllCases, CaseData } from '../../services/caseService';

interface CalendarProps {
  userRole: UserRole;
}

type EventType = 'Deadline' | 'Court' | 'Meeting' | 'Deposition' | 'Other';

const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const pad2 = (n: number) => String(n).padStart(2, '0');
const toISODate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const endOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth() + 1, 0);
const startOfWeek = (d: Date) => {
  const copy = new Date(d);
  const day = copy.getDay();
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
};
const endOfWeek = (d: Date) => {
  const s = startOfWeek(d);
  const e = new Date(s);
  e.setDate(s.getDate() + 6);
  return e;
};

const getTypeColorClass = (type: string) => {
  switch (type) {
    case 'Deadline': return 'bg-red-100 text-red-700 border-red-200';
    case 'Court': return 'bg-blue-100 text-blue-700 border-blue-200';
    case 'Meeting': return 'bg-green-100 text-green-700 border-green-200';
    case 'Deposition': return 'bg-purple-100 text-purple-700 border-purple-200';
    default: return 'bg-gray-100 text-gray-700 border-gray-200';
  }
};

export default function Calendar({ userRole }: CalendarProps) {
  const [currentView, setCurrentView] = useState<'month' | 'week'>('month');
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all'); 
  
  const [events, setEvents] = useState<FirmCalendarEvent[]>([]);
  const [tasks, setTasks] = useState<CalendarTask[]>([]);
  const [cases, setCases] = useState<CaseData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  usePageTitle('Calendar');
  // Add Event modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEvent, setNewEvent] = useState<{ caseId: string; title: string; type: EventType; date: string; time: string; description: string; }>({
    caseId: '',
    title: '',
    type: 'Meeting',
    date: '',
    time: '',
    description: '',
  });

  // Detail modal for event/task
  const [showDetail, setShowDetail] = useState(false);
  const [detailItem, setDetailItem] = useState<{ kind: 'event' | 'task'; data: any } | null>(null);

  // Edit event modal
  const [showEditEvent, setShowEditEvent] = useState(false);
  const [editEvent, setEditEvent] = useState<{ _id: string; caseId: string; title: string; type: EventType; date: string; time: string; description: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const isMDorAdmin = userRole === 'managing_director' ||
    userRole === 'managing_partner' ||
    userRole === 'senior_partner' ||
    userRole === 'partner' ||
    userRole === 'associate_partner' ||
    userRole === 'executive_assistant';

  const subtitle =
    userRole === 'managing_director' ||
    userRole === 'managing_partner' ||
    userRole === 'senior_partner' ||
    userRole === 'partner' ||
    userRole === 'associate_partner'
      ? 'View and manage firm-wide legal milestones'
      : userRole === 'associate' || userRole === 'trainee_associate' || userRole === 'senior_associate' || userRole === 'intern'
        ? 'Track your case-specific events and tasks'
        : 'Coordinate scheduling & reminders for all files';

  const range = useMemo(() => {
    const from = currentView === 'week' ? toISODate(startOfWeek(selectedDate)) : toISODate(startOfMonth(selectedDate));
    const to = currentView === 'week' ? toISODate(endOfWeek(selectedDate)) : toISODate(endOfMonth(selectedDate));
    return { from, to };
  }, [currentView, selectedDate]);

  const loadCalendar = async () => {
    setLoading(true);
    setError('');
    try {
      const [evts, tsks, allCases] = await Promise.all([
        getFirmEvents({ from: range.from, to: range.to, type: typeFilter, q: search }),
        getCalendarTasks({ from: range.from, to: range.to, q: search }),
        getAllCases(),
      ]);
      setEvents(evts);
      setTasks(tsks);
      setCases(allCases);
    } catch (err: any) {
      setError(err.message || 'Failed to load calendar');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadCalendar(); /* eslint-disable-next-line */ }, [range.from, range.to, typeFilter, currentView]);
  useEffect(() => {
    const t = setTimeout(() => loadCalendar(), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const goToPrevious = () => {
    if (currentView === 'week') setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() - 7));
    else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() - 1, 1));
  };

  const goToNext = () => {
    if (currentView === 'week') setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), selectedDate.getDate() + 7));
    else setSelectedDate(new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1));
  };

  const openAdd = () => {
    const now = new Date();
    setNewEvent({
      caseId: '',
      title: '',
      type: 'Meeting',
      date: toISODate(now),
      time: '09:00',
      description: '',
    });
    setShowAddModal(true);
  };

  const submitNewEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEvent.caseId || !newEvent.title || !newEvent.date || !newEvent.time) return;
    try {
      setActionLoading(true);
      await addEventToCase(newEvent.caseId, {
        caseId: newEvent.caseId,
        title: newEvent.title,
        type: newEvent.type,
        date: newEvent.date,
        time: newEvent.time,
        description: newEvent.description,
      });
      setShowAddModal(false);
      await loadCalendar();
    } catch (err: any) {
      setError(err.message || 'Failed to add event');
    } finally {
      setActionLoading(false);
    }
  };

  const openDetail = (kind: 'event' | 'task', data: any) => {
    setDetailItem({ kind, data });
    setShowDetail(true);
  };

  const openEdit = (ev: FirmCalendarEvent) => {
    setEditEvent({
      _id: ev._id!,
      caseId: ev.caseId,
      title: ev.title,
      type: (ev.type as EventType) || 'Other',
      date: ev.date,
      time: ev.time,
      description: ev.description || '',
    });
    setShowDetail(false);
    setShowEditEvent(true);
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editEvent?._id) return;
    try {
      setActionLoading(true);
      await updateEvent(editEvent._id, {
        title: editEvent.title,
        type: editEvent.type,
        date: editEvent.date,
        time: editEvent.time,
        description: editEvent.description,
      });
      setShowEditEvent(false);
      setEditEvent(null);
      await loadCalendar();
    } catch (err: any) {
      setError(err.message || 'Failed to update event');
    } finally {
      setActionLoading(false);
    }
  };

  const doDelete = async (eventId: string) => {
    if (!confirm('Delete this event?')) return;
    try {
      setActionLoading(true);
      await deleteEvent(eventId);
      setShowDetail(false);
      setShowEditEvent(false);
      await loadCalendar();
    } catch (err: any) {
      setError(err.message || 'Failed to delete event');
    } finally {
      setActionLoading(false);
    }
  };

  // Month view helpers
  const daysInMonth = endOfMonth(selectedDate).getDate();
  const firstDayOfMonth = startOfMonth(selectedDate).getDay();
  const getEventsForDay = (day: number) => {
    const dateStr = `${selectedDate.getFullYear()}-${pad2(selectedDate.getMonth() + 1)}-${pad2(day)}`;
    return events.filter((e) => e.date === dateStr);
  };
  const getTasksForDay = (day: number) => {
    const dateStr = `${selectedDate.getFullYear()}-${pad2(selectedDate.getMonth() + 1)}-${pad2(day)}`;
    return tasks.filter((t) => t.dueDate === dateStr);
  };

  const upcoming = useMemo(() => {
    const mix = [
      ...events.map((e) => ({ kind: 'event' as const, date: e.date, time: e.time, title: e.title, data: e })),
      ...tasks.map((t) => ({ kind: 'task' as const, date: t.dueDate, time: '23:59', title: t.title, data: t })),
    ];
    return mix
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))
      .slice(0, 10);
  }, [events, tasks]);

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">Firm Calendar</h1>
            <p className="text-gray-600">{subtitle}</p>
          </div>

          {isMDorAdmin && (
            <button onClick={openAdd} className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Event
            </button>
          )}
        </div>

        {/* Controls */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <button onClick={goToPrevious} className="p-2 hover:bg-gray-100 rounded">
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>

            <h2 className="text-lg font-semibold text-gray-900">
              {currentView === 'month'
                ? `${monthNames[selectedDate.getMonth()]} ${selectedDate.getFullYear()}`
                : `Week of ${toISODate(startOfWeek(selectedDate))} → ${toISODate(endOfWeek(selectedDate))}`}
            </h2>

            <button onClick={goToNext} className="p-2 hover:bg-gray-100 rounded">
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <div className="relative">

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder=" Search events/tasks..."
                className="w-full sm:w-64 pl-9 pr-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
              />
            </div>

            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
            >
              <option value="all">All Types</option>
              <option value="Deadline">Deadline</option>
              <option value="Court">Court</option>
              <option value="Meeting">Meeting</option>
              <option value="Deposition">Deposition</option>
              <option value="Other">Other</option>
            </select>

            <div className="flex gap-2">
              <button
                onClick={() => setCurrentView('month')}
                className={`px-3 py-2 text-sm rounded ${currentView === 'month' ? 'bg-gray-800 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                Month
              </button>
              <button
                onClick={() => setCurrentView('week')}
                className={`px-3 py-2 text-sm rounded ${currentView === 'week' ? 'bg-gray-800 text-white' : 'border border-gray-300 text-gray-700 hover:bg-gray-50'}`}
              >
                Week
              </button>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}
      </div>

      {/* Calendar Area */}
      {currentView === 'month' ? (
        <div className="bg-white border rounded-lg overflow-hidden border-gray-200">
          <div className="grid grid-cols-7 border-b bg-gray-50">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
              <div key={d} className="px-2 py-3 text-center text-xs font-medium text-gray-700 uppercase">{d}</div>
            ))}
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-500">Loading...</div>
          ) : (
            <div className="grid grid-cols-7">
              {Array.from({ length: firstDayOfMonth }).map((_, i) => (
                <div key={`empty-${i}`} className="min-h-24 border-b border-r bg-gray-50" />
              ))}

              {Array.from({ length: daysInMonth }).map((_, idx) => {
                const day = idx + 1;
                const today = new Date();
                const isToday = day === today.getDate() && selectedDate.getMonth() === today.getMonth() && selectedDate.getFullYear() === today.getFullYear();

                const dayEvents = getEventsForDay(day);
                const dayTasks = getTasksForDay(day);

                return (
                  <div key={day} className={`min-h-24 border-b border-r p-2 hover:bg-gray-50 ${isToday ? 'bg-blue-50' : ''}`}>
                    <div className={`text-sm font-medium mb-1 ${isToday ? 'w-6 h-6 bg-blue-600 text-white rounded-full flex items-center justify-center' : 'text-gray-900'}`}>
                      {day}
                    </div>

                    <div className="space-y-1">
                      {dayEvents.slice(0, 2).map((ev) => (
                        <button
                          key={ev._id}
                          type="button"
                          onClick={() => openDetail('event', ev)}
                          className={`w-full text-left text-xs px-1 py-0.5 rounded border truncate ${getTypeColorClass(ev.type)}`}
                          title={`${ev.time} - ${ev.title}`}
                        >
                          {ev.time?.slice(0, 5)} {ev.title}
                        </button>
                      ))}

                      {dayTasks.slice(0, 1).map((t) => (
                        <button
                          key={t._id}
                          type="button"
                          onClick={() => openDetail('task', t)}
                          className="w-full text-left text-xs px-1 py-0.5 rounded border truncate bg-gray-100 text-gray-800 border-gray-200"
                          title={`Task due: ${t.title}`}
                        >
                          Task: {t.title}
                        </button>
                      ))}

                      {dayEvents.length + dayTasks.length > 3 && (
                        <div className="text-xs text-gray-500 px-1">+{dayEvents.length + dayTasks.length - 3} more</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b bg-gray-50">
            <h3 className="font-semibold text-gray-900">Week Events & Tasks</h3>
            <p className="text-sm text-gray-600">{range.from} → {range.to}</p>
          </div>

          {loading ? (
            <div className="py-12 text-center text-gray-500">Loading...</div>
          ) : (
            <div className="divide-y divide-gray-200">
              {[...events.map(e => ({ kind: 'event' as const, date: e.date, time: e.time, data: e })),
                ...tasks.map(t => ({ kind: 'task' as const, date: t.dueDate, time: '23:59', data: t }))]
                .sort((a,b)=> (a.date+a.time).localeCompare(b.date+b.time))
                .map((row, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => openDetail(row.kind, row.data)}
                    className="w-full text-left px-5 py-4 hover:bg-gray-50"
                  >
                    <div className="flex items-start justify-between gap-6">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {row.kind === 'event' ? (
                            <span className={`px-2 py-0.5 text-xs rounded border ${getTypeColorClass(row.data.type)}`}>
                              {row.data.automated ? 'Workflow deadline' : row.data.type}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 text-xs rounded border bg-gray-100 text-gray-800 border-gray-200">
                              Task Due
                            </span>
                          )}
                          <span className="text-xs text-gray-500">{row.date} • {row.kind === 'event' ? row.data.time : 'EOD'}</span>
                        </div>

                        <div className="text-sm font-semibold text-gray-900">
                          {row.kind === 'event' ? row.data.title : row.data.title}
                        </div>

                        <div className="text-xs text-gray-500">
                          {row.data.case?.parties || row.data.case?.caseNo || '—'}
                        </div>
                      </div>

                      <span className="text-xs text-gray-600">Open →</span>
                    </div>
                  </button>
                ))}
              {events.length === 0 && tasks.length === 0 && (
                <div className="py-12 text-center text-gray-500">No items this week.</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Upcoming list */}
      <div className="mt-6 bg-white border border-gray-200 rounded-lg">
        <div className="px-5 py-4 border-b">
          <h2 className="font-semibold text-gray-900">Upcoming</h2>
        </div>
        <div className="divide-y divide-gray-200">
          {upcoming.length === 0 ? (
            <div className="px-5 py-8 text-gray-500">No upcoming items.</div>
          ) : (
            upcoming.map((u, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => openDetail(u.kind, u.data)}
                className="w-full text-left px-5 py-4 hover:bg-gray-50"
              >
                <div className="flex items-start justify-between gap-6">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      {u.kind === 'event' ? (
                        <span className={`px-2 py-0.5 text-xs rounded border ${getTypeColorClass(u.data.type)}`}>
                          {u.data.automated ? 'Workflow deadline' : u.data.type}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 text-xs rounded border bg-gray-100 text-gray-800 border-gray-200">Task Due</span>
                      )}
                      <span className="text-xs text-gray-500">
                        {u.kind === 'event' ? `${u.data.date} • ${u.data.time}` : `${u.data.dueDate} • EOD`}
                      </span>
                    </div>
                    <p className="text-sm font-medium text-gray-900">{u.data.title}</p>
                    <p className="text-xs text-gray-500">{u.data.case?.parties || u.data.case?.caseNo || '—'}</p>
                  </div>
                  <span className="text-xs text-gray-600">Open →</span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="mt-6 bg-white border rounded-lg p-5 border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Legend</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {(['Deadline','Court','Meeting','Deposition','Other'] as EventType[]).map((t) => (
            <div className="flex items-center gap-2" key={t}>
              <div className={`w-3 h-3 rounded ${
                t === 'Deadline' ? 'bg-red-500' :
                t === 'Court' ? 'bg-blue-500' :
                t === 'Meeting' ? 'bg-green-500' :
                t === 'Deposition' ? 'bg-purple-500' : 'bg-gray-500'
              }`} />
              <span className="text-sm text-gray-700">{t}</span>
            </div>
          ))}
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded bg-gray-400" />
            <span className="text-sm text-gray-700">Task Due</span>
          </div>
        </div>
      </div>

      {/* Detail Modal */}
      {showDetail && detailItem && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full flex flex-col" style={{ maxHeight: '90vh' }}>
            <div className="p-6 border-b flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-gray-900">
                  {detailItem.kind === 'event' ? detailItem.data.title : `Task Due: ${detailItem.data.title}`}
                </h3>
                <p className="text-sm text-gray-500 mt-1">
                  {detailItem.kind === 'event'
                    ? `${detailItem.data.date} at ${detailItem.data.time} • ${detailItem.data.type}`
                    : `${detailItem.data.dueDate} • Assignee: ${detailItem.data.assignee}`}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowDetail(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              >
                Close
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 p-6">
              <div>
                <p className="text-sm font-medium text-gray-700 mb-1">Case</p>
                <p className="text-sm text-gray-900">
                  {detailItem.data.case?.parties || detailItem.data.case?.caseNo || '—'}
                </p>
              </div>

              {detailItem.kind === 'event' && detailItem.data.description ? (
                <div>
                  <p className="text-sm font-medium text-gray-700 mb-1">Description</p>
                  <p className="text-sm text-gray-600 whitespace-pre-line">{detailItem.data.description}</p>
                </div>
              ) : null}
            </div>

            <div className="p-6 border-t flex gap-3">
              <button
                type="button"
                onClick={() => {
                  if (detailItem.data.caseId) window.location.href = `/cases/${detailItem.data.caseId}`;
                }}
                className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
              >
                Open Case
              </button>

              {detailItem.kind === 'task' && (
                <button
                  type="button"
                  onClick={() => window.location.href = `/tasks/${detailItem.data._id}`}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Open Task
                </button>
              )}

              {detailItem.kind === 'event' && isMDorAdmin && !detailItem.data.automated && (
                <>
                  <button
                    type="button"
                    onClick={() => openEdit(detailItem.data)}
                    className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
                  >
                    <Pencil className="w-4 h-4 inline mr-2" />
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => doDelete(detailItem.data._id)}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-60"
                  >
                    <Trash2 className="w-4 h-4 inline mr-2" />
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Add Event Modal (Edit Case style) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full flex flex-col" style={{ maxHeight: '90vh' }}>
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Add Event</h3>
              <p className="text-sm text-gray-500 mt-1">This event will be linked to a case</p>
            </div>

            <form onSubmit={submitNewEvent} className="flex-1 overflow-y-auto space-y-4 p-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Related Case *</label>
                <select
                  value={newEvent.caseId}
                  onChange={(e) => setNewEvent((p) => ({ ...p, caseId: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                >
                  <option value="">Select case</option>
                  {cases.map((c) => (
                    <option key={c._id} value={c._id}>
                      {c.caseNo} — {c.parties}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  value={newEvent.title}
                  onChange={(e) => setNewEvent((p) => ({ ...p, title: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={newEvent.type}
                    onChange={(e) => setNewEvent((p) => ({ ...p, type: e.target.value as EventType }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                  >
                    <option value="Deadline">Deadline</option>
                    <option value="Court">Court</option>
                    <option value="Meeting">Meeting</option>
                    <option value="Deposition">Deposition</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={newEvent.date}
                    onChange={(e) => setNewEvent((p) => ({ ...p, date: e.target.value }))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Time *</label>
                <input
                  type="time"
                  value={newEvent.time}
                  onChange={(e) => setNewEvent((p) => ({ ...p, time: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={newEvent.description}
                  onChange={(e) => setNewEvent((p) => ({ ...p, description: e.target.value }))}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>

              <div className="flex gap-3 mt-6 sticky bottom-0 bg-white pt-4">
                <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={actionLoading} className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-60">
                  {actionLoading ? 'Saving...' : 'Add Event'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Event Modal */}
      {showEditEvent && editEvent && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-lg w-full flex flex-col" style={{ maxHeight: '90vh' }}>
            <div className="p-6 border-b">
              <h3 className="text-lg font-semibold text-gray-900">Edit Event</h3>
            </div>

            <form onSubmit={saveEdit} className="flex-1 overflow-y-auto space-y-4 p-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title *</label>
                <input
                  value={editEvent.title}
                  onChange={(e) => setEditEvent((p) => (p ? { ...p, title: e.target.value } : p))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={editEvent.type}
                    onChange={(e) => setEditEvent((p) => (p ? { ...p, type: e.target.value as EventType } : p))}
                    className="w-full px-3 py-2 border border-gray-300 rounded bg-white"
                  >
                    <option value="Deadline">Deadline</option>
                    <option value="Court">Court</option>
                    <option value="Meeting">Meeting</option>
                    <option value="Deposition">Deposition</option>
                    <option value="Other">Other</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date *</label>
                  <input
                    type="date"
                    value={editEvent.date}
                    onChange={(e) => setEditEvent((p) => (p ? { ...p, date: e.target.value } : p))}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Time *</label>
                <input
                  type="time"
                  value={editEvent.time}
                  onChange={(e) => setEditEvent((p) => (p ? { ...p, time: e.target.value } : p))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                <textarea
                  value={editEvent.description}
                  onChange={(e) => setEditEvent((p) => (p ? { ...p, description: e.target.value } : p))}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded"
                />
              </div>

              <div className="flex gap-3 mt-6 sticky bottom-0 bg-white pt-4">
                <button type="button" onClick={() => setShowEditEvent(false)} className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={actionLoading} className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700 disabled:opacity-60">
                  {actionLoading ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
