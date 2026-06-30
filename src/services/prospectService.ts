import axios from 'axios';

// Use the same API URL env var across the app
const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const getToken = () => localStorage.getItem('token');
const getAuthHeaders = () => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface ProspectContact {
  name: string;
  email?: string;
  phone?: string;
  position?: string;
}

export type ProspectStage =
  | 'Inquiry'
  | 'Consultation'
  | 'Conflict Check'
  | 'Quotation'
  | 'Quotation Preparation'
  | 'Conversion Assessment'
  | 'Quotation Issued'
  | 'Awaiting Client Decision'
  | 'Final Follow-Up'
  | 'Engagement'
  | 'Converted'
  | 'Non-Converted';

export interface Prospect {
  _id: string;
  prospectNo: string;
  clientName: string;
  parties?: string;
  enquiryNature?: string;
  priorityLevel?: 'High' | 'Medium' | 'Low';
  enquirySource?: string;
  referralSource?: string;
  estimatedMatterValue?: number;
  estimatedFeeValue?: number;
  contact: ProspectContact;
  responsiblePartner?: string | { _id: string; name: string; email?: string; role?: string };
  responsibleAssociate?: string | { _id: string; name: string; email?: string; role?: string };
  legalServicePath?: { id: string; label: string }[];
  inquiryDescription: string;
  dateReceived: Date;
  stage: ProspectStage;
  conflictCheckStatus?: 'Pending' | 'Cleared' | 'Flagged';
  conflictCheckDate?: Date;
  conflictCheckNotes?: string;
  conversionOutcome?: string;
  quotationAmount?: number;
  quotationDate?: Date;
  engagementDate?: Date;
  engagementNotes?: string;
  conversionReason?: string;
  assignedTo: string | { _id: string; name: string; email?: string };
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
  responsibleAssociate?: string;
}): Promise<Prospect[]> => {
  const params = new URLSearchParams();
  if (filters?.stage) params.append('stage', filters.stage);
  if (filters?.assignedTo) params.append('assignedTo', filters.assignedTo);
  if (filters?.isActive !== undefined) params.append('isActive', String(filters.isActive));
  if (filters?.responsibleAssociate) params.append('responsibleAssociate', filters.responsibleAssociate);
  const response = await axios.get(`${API_BASE_URL}/prospects?${params}`, { headers: getAuthHeaders() });
  return response.data;
};

export const getProspectById = async (id: string): Promise<Prospect> => {
  const response = await axios.get(`${API_BASE_URL}/prospects/${id}`, { headers: getAuthHeaders() });
  return response.data;
};

export const createProspect = async (data: Partial<Prospect>): Promise<Prospect> => {
  try {
    const token = getToken();
    if (!token) throw new Error('Not authenticated. Please login again.');
    
    const response = await axios.post(`${API_BASE_URL}/prospects`, data, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    });
    return response.data;
  } catch (error: any) {
    const message = error?.response?.data?.message || error?.message || 'Failed to create prospect';
    const err: any = new Error(message);
    err.statusCode = error?.response?.status;
    throw err;
  }
};

export const updateProspect = async (id: string, data: Partial<Prospect>): Promise<Prospect> => {
  try {
    const token = getToken();
    if (!token) throw new Error('Not authenticated. Please login again.');
    
    const response = await axios.put(`${API_BASE_URL}/prospects/${id}`, data, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    });
    return response.data;
  } catch (error: any) {
    const message = error?.response?.data?.message || error?.message || 'Failed to update prospect';
    const err: any = new Error(message);
    err.statusCode = error?.response?.status;
    throw err;
  }
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
