const API_URL = import.meta.env.VITE_API_URL;

export interface CaseEvent {
  _id?: string;
  caseId: string;
  title: string;
  type: string;
  date: string;
  time: string;
  description?: string;
  automated?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

const getToken = () => localStorage.getItem('token');

export const getEventsForCase = async (caseId: string): Promise<CaseEvent[]> => {
  const res = await fetch(`${API_URL}/cases/${caseId}/events`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch events');
  return res.json();
};

export const addEventToCase = async (
  caseId: string,
  event: CaseEvent
): Promise<CaseEvent> => {
  const res = await fetch(`${API_URL}/cases/${caseId}/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(event),
  });

  if (!res.ok) throw new Error((await res.json()).message || 'Failed to create event');
  return res.json();
};

export const updateEvent = async (
  eventId: string,
  updates: Partial<CaseEvent>
): Promise<CaseEvent> => {
  const res = await fetch(`${API_URL}/events/${eventId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(updates),
  });

  if (!res.ok) throw new Error((await res.json()).message || 'Failed to update event');
  return res.json();
};

export const deleteEvent = async (eventId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/events/${eventId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) throw new Error((await res.json()).message || 'Failed to delete event');
};

export type FirmCalendarEvent = CaseEvent & {
  case?: {
    _id: string;
    caseNo: string;
    parties: string;
  } | null;
};

export const getFirmEvents = async (params: {
  from: string;
  to: string;
  type?: string;
  q?: string;
}): Promise<FirmCalendarEvent[]> => {
  const qs = new URLSearchParams();

  qs.set('from', params.from);
  qs.set('to', params.to);

  if (params.type) qs.set('type', params.type);
  if (params.q) qs.set('q', params.q);

  const res = await fetch(`${API_URL}/calendar/events?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch firm events');
  return res.json();
};

export type CalendarTask = {
  _id: string;
  caseId: string;
  title: string;
  dueDate: string;
  priority: string;
  status: string;
  assignee: string;
  requiresApproval?: boolean;
  approvalStatus?: string;
  case?: {
    _id: string;
    caseNo: string;
    parties: string;
  } | null;
};

export const getCalendarTasks = async (params: {
  from: string;
  to: string;
  q?: string;
}): Promise<CalendarTask[]> => {
  const qs = new URLSearchParams();

  qs.set('from', params.from);
  qs.set('to', params.to);

  if (params.q) qs.set('q', params.q);

  const res = await fetch(`${API_URL}/calendar/tasks?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });

  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch calendar tasks');
  return res.json();
};
