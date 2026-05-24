import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001/api';
const getToken = () => localStorage.getItem('token');
const getAuthHeaders = () => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface ProspectContact {
  name: string;
  email: string;
  phone: string;
  position?: string;
}

export interface Prospect {
  _id: string;
  prospectNo: string;
  clientName: string;
  contact: ProspectContact;
  legalServicePath?: { id: string; label: string }[];
  inquiryDescription: string;
  dateReceived: Date;
  stage: 'Inquiry' | 'Consultation' | 'Conflict Check' | 'Quotation' | 'Engagement' | 'Converted' | 'Non-Converted';
  conflictCheckStatus?: 'Pending' | 'Cleared' | 'Flagged';
  conflictCheckDate?: Date;
  conflictCheckNotes?: string;
  estimatedMatterValue?: number;
  quotationAmount?: number;
  quotationDate?: Date;
  engagementDate?: Date;
  engagementNotes?: string;
  conversionReason?: string;
  assignedTo: string;
  createdBy: string;
  isActive: boolean;
  convertedToMatters?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const getAllProspects = async (filters?: {
  stage?: string;
  assignedTo?: string;
  isActive?: boolean;
}): Promise<Prospect[]> => {
  const params = new URLSearchParams();
  if (filters?.stage) params.append('stage', filters.stage);
  if (filters?.assignedTo) params.append('assignedTo', filters.assignedTo);
  if (filters?.isActive !== undefined) params.append('isActive', String(filters.isActive));
  const response = await axios.get(`${API_BASE_URL}/prospects?${params}`, { headers: getAuthHeaders() });
  return response.data;
};

export const getProspectById = async (id: string): Promise<Prospect> => {
  const response = await axios.get(`${API_BASE_URL}/prospects/${id}`, { headers: getAuthHeaders() });
  return response.data;
};

export const createProspect = async (data: Partial<Prospect>): Promise<Prospect> => {
  const token = getToken();
  const response = await axios.post(`${API_BASE_URL}/prospects`, data, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return response.data;
};

export const updateProspect = async (id: string, data: Partial<Prospect>): Promise<Prospect> => {
  const token = getToken();
  const response = await axios.put(`${API_BASE_URL}/prospects/${id}`, data, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return response.data;
};

export const deleteProspect = async (id: string): Promise<void> => {
  await axios.delete(`${API_BASE_URL}/prospects/${id}`, { headers: getAuthHeaders() });
};

export const getProspectStats = async (): Promise<Record<string, number>> => {
  const response = await axios.get(`${API_BASE_URL}/prospects/stats`, { headers: getAuthHeaders() });
  return response.data;
};

export const convertProspectToMatter = async (id: string): Promise<{
  message: string;
  prospect: Prospect;
  matter: any;
}> => {
  const response = await axios.post(`${API_BASE_URL}/prospects/${id}/convert`, {}, { headers: getAuthHeaders() });
  return response.data;
};
