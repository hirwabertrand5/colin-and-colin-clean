import { UserRole } from '../App';

const API_URL = import.meta.env.VITE_API_URL;

export interface LoginResponse {
  token: string;
  user: {
    id: string;
    name: string;
    email: string;
    role: UserRole; // ✅ change from string to UserRole
  };
}

export const loginApi = async (
  email: string,
  password: string
): Promise<LoginResponse> => {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.message || 'Login failed');
  }

  return data as LoginResponse;
};