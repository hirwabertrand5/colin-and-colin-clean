const API_URL = import.meta.env.VITE_API_URL;
const getToken = () => localStorage.getItem('token');

const authHeaders = () => ({
  Authorization: `Bearer ${getToken()}`,
});

export type ExecutiveDashboardResponse = {
  stats: {
    casesCreatedMTD: number;
    documentsUploadedMTD: number;
    scheduledEventsMTD: number;
    tasksCoordinatedMTD: number;
  };
  today: {
    dateISO: string;
    label: string;
  };
  todaySchedule: {
    id: string;
    time: string;
    title: string;
    type: string;
    description?: string;
  }[];
  pendingFollowUp: {
    id: string;
    type: string;
    title: string;
    assignedTo: string;
    status: string;
    dueDate: string;
    priority?: string;
  }[];
  recentCases: {
    id: string;
    name: string;
    status: string;
    client: string;
    createdDate: string;
  }[];
};

export const getExecutiveAssistantDashboard = async (): Promise<ExecutiveDashboardResponse> => {
  const res = await fetch(`${API_URL}/dashboard/executive-assistant`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to load dashboard');
  return res.json();
};