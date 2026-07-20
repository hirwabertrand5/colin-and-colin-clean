import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const getToken = () => localStorage.getItem('token');
const getAuthHeaders = () => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface ProspectFeedback {
  _id?: string;
  prospectId: string;
  primaryReasonCategory?: string;
  primaryReasonDetail?: string;
  clientComment?: string;
  completedByRole?: string;
  internalCategory?: string;
  wasAvoidable?: boolean;
  estimatedConversionProbability?: string;
  firmImprovementNotes?: string;
  partnerApprovalStatus?: 'Pending' | 'Approved';
  feedbackEmailSentAt?: string;
}

export const getProspectFeedback = async (prospectId: string): Promise<ProspectFeedback | null> => {
  const response = await axios.get(`${API_BASE_URL}/prospect-feedback/${prospectId}`, { headers: getAuthHeaders() });
  return response.data;
};

export const upsertProspectFeedback = async (prospectId: string, payload: Partial<ProspectFeedback>): Promise<ProspectFeedback> => {
  const response = await axios.put(`${API_BASE_URL}/prospect-feedback/${prospectId}`, payload, { headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' } });
  return response.data;
};

export const submitPublicProspectFeedback = async (prospectId: string, payload: { primaryReasonCategory?: string; primaryReasonDetail?: string; clientComment?: string }) => {
  const response = await axios.post(`${API_BASE_URL}/prospect-feedback/public/${prospectId}`, payload, { headers: { 'Content-Type': 'application/json' } });
  return response.data;
};
