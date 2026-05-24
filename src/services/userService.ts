const API_URL = import.meta.env.VITE_API_URL;
  
export interface User {
  _id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLogin?: string;
}

export interface NewUserData {
  name: string;
  email: string;
  role: string;
  password: string;
}

const getToken = () => localStorage.getItem('token');

const handleAuthError = (res: Response) => {
  if (res.status === 401 || res.status === 403) {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
    throw new Error('Session expired. Please log in again.');
  }
};

export const getAllUsers = async (): Promise<User[]> => {
  const res = await fetch(`${API_URL}/users`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  handleAuthError(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to fetch users');
  return res.json();
};

export const addUser = async (userData: NewUserData): Promise<User> => {
  const res = await fetch(`${API_URL}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(userData),
  });
  handleAuthError(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to create user');
  return res.json();
};

export const editUser = async (userId: string, userData: Partial<NewUserData>): Promise<User> => {
  const res = await fetch(`${API_URL}/users/${userId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify(userData),
  });
  handleAuthError(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to update user');
  return res.json();
};

export const resetUserPassword = async (userId: string, newPassword: string): Promise<void> => {
  const res = await fetch(`${API_URL}/users/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ userId, newPassword }),
  });
  handleAuthError(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to reset password');
};

export const setUserActiveStatus = async (userId: string, isActive: boolean): Promise<void> => {
  const res = await fetch(`${API_URL}/users/set-active`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getToken()}`,
    },
    body: JSON.stringify({ userId, isActive }),
  });
  handleAuthError(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to update user status');
};

export const deleteUser = async (userId: string): Promise<void> => {
  const res = await fetch(`${API_URL}/users/${userId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${getToken()}`,
    },
  });
  handleAuthError(res);
  if (!res.ok) throw new Error((await res.json()).message || 'Failed to delete user');
};