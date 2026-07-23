import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const getToken = () => localStorage.getItem('token');
const getAuthHeaders = () => {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export interface FeedbackRequestPayload {
  clientId?: string;
  clientType?: 'prospect' | 'matter' | 'client';
  prospectId?: string;
  matterId?: string;
  feedbackType: string;
  clientEmail: string;
}

export const sendClientExperienceRequest = async (payload: FeedbackRequestPayload) => {
  const response = await axios.post(`${API_BASE_URL}/client-experience/request/send`, payload, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  return response.data;
};

export const resendClientExperienceRequest = async (requestId: string) => {
  const response = await axios.post(`${API_BASE_URL}/client-experience/request/${requestId}/resend`, {}, {
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    timeout: 20000,
  });
  return response.data;
};
