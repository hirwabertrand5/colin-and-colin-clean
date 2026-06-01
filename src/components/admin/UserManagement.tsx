import { useEffect, useState, useRef, useMemo } from 'react';
import { Search, Plus, Edit, UserPlus, Power, PowerOff, Key, Trash2 } from 'lucide-react';
import usePageTitle from '../../hooks/usePageTitle';
import {
  getAllUsers,
  addUser,
  setUserActiveStatus,
  editUser,
  resetUserPassword,
  deleteUser as deleteUserApi,
  User,
  NewUserData,
} from '../../services/userService';

const ROLE_OPTIONS = [
  { value: 'intern', label: 'Intern' },
  { value: 'trainee_associate', label: 'Trainee Associate' },
  { value: 'associate', label: 'Associate' },
  { value: 'executive_assistant', label: 'Executive Assistant' },
  { value: 'senior_associate', label: 'Senior Associate' },
  { value: 'senior_executive_assistant', label: 'Senior Executive Assistant' },
  { value: 'associate_partner', label: 'Associate Partner' },
  { value: 'executive_associate_partner', label: 'Executive Associate Partner' },
  { value: 'partner', label: 'Partner' },
  { value: 'executive_partner', label: 'Executive Partner' },
  { value: 'managing_partner', label: 'Managing Partner' },
  { value: 'executive_managing_partner', label: 'Executive Managing Partner' },
  { value: 'senior_partner', label: 'Senior Partner' },
  { value: 'originating_attorney', label: 'Originating Attorney' },
  { value: 'managing_director', label: 'Managing Director' },
];

const ROLE_DISPLAY_MAP: Record<string, string> = {
  managing_director: 'Managing Director',
  managing_partner: 'Managing Partner',
  executive_managing_partner: 'Executive Managing Partner',
  senior_partner: 'Senior Partner',
  partner: 'Partner',
  executive_partner: 'Executive Partner',
  associate_partner: 'Associate Partner',
  executive_associate_partner: 'Executive Associate Partner',
  senior_associate: 'Senior Associate',
  senior_executive_assistant: 'Senior Executive Assistant',
  associate: 'Associate',
  trainee_associate: 'Trainee Associate',
  executive_assistant: 'Executive Assistant',
  originating_attorney: 'Originating Attorney',
  intern: 'Intern',
};

type AppStoredUser = {
  id?: string;
  _id?: string;
  name?: string;
  email?: string;
  role?: string;
};

export default function UserManagement() {
  const [users, setUsers] = useState<User[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  usePageTitle('User Management');
  const [form, setForm] = useState<NewUserData>({
    name: '',
    email: '',
    role: 'managing_director',
    password: '',
  });
  const [editForm, setEditForm] = useState<Partial<NewUserData>>({});
  const [resetPassword, setResetPassword] = useState('');

  // Inactivity timer
  const timer = useRef<NodeJS.Timeout | null>(null);

  // Determine current role (no prop passed, so read from localStorage)
  const currentRole = useMemo(() => {
    try {
      const raw = localStorage.getItem('user');
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as AppStoredUser;
      return parsed.role;
    } catch {
      return undefined;
    }
  }, []);

  // ✅ Now Executive Assistant has full access like Managing Director
  const canManageUsers = currentRole === 'managing_director' || currentRole === 'executive_assistant';

  // Fetch users on mount
  useEffect(() => {
    loadUsers();
    startInactivityTimer();
    window.addEventListener('mousemove', resetInactivityTimer);
    window.addEventListener('keydown', resetInactivityTimer);
    return () => {
      window.removeEventListener('mousemove', resetInactivityTimer);
      window.removeEventListener('keydown', resetInactivityTimer);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line
  }, []);

  const startInactivityTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }, 30 * 60 * 1000); // 30 minutes
  };

  const resetInactivityTimer = () => {
    startInactivityTimer();
  };

  const loadUsers = async () => {
    try {
      setLoading(true);
      const data = await getAllUsers();
      setUsers(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageUsers) return;

    setError('');
    setSuccess('');
    try {
      const newUser = await addUser(form);
      setSuccess('User created successfully!');
      setUsers([...users, newUser]);
      setForm({ name: '', email: '', role: 'managing_director', password: '' });
      setShowAddModal(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageUsers) return;
    if (!selectedUser) return;

    setError('');
    setSuccess('');
    try {
      await editUser(selectedUser._id, editForm);
      setUsers(users.map(u => (u._id === selectedUser._id ? { ...u, ...editForm } as any : u)));
      setSuccess('User updated successfully!');
      setShowEditModal(false);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleResetUserPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageUsers) return;
    if (!selectedUser) return;

    setError('');
    setSuccess('');
    try {
      await resetUserPassword(selectedUser._id, resetPassword);
      setSuccess('Password reset successfully!');
      setShowResetModal(false);
      setResetPassword('');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleToggleStatus = async (userId: string, currentStatus: boolean) => {
    if (!canManageUsers) return;

    try {
      await setUserActiveStatus(userId, !currentStatus);
      setUsers(users.map(u => (u._id === userId ? { ...u, isActive: !currentStatus } : u)));
      setSuccess(`User ${!currentStatus ? 'activated' : 'deactivated'} successfully!`);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleDeleteUser = async (userId: string) => {
    if (!canManageUsers) return;

    if (!window.confirm('Are you sure you want to delete this user?')) return;
    setError('');
    setSuccess('');
    try {
      await deleteUserApi(userId);
      setUsers(users.filter(u => u._id !== userId));
      setSuccess('User deleted successfully!');
    } catch (err: any) {
      setError(err.message);
    }
  };

  const getRoleColor = (role: string) => {
    switch (role) {
      case 'managing_director': return 'bg-purple-100 text-purple-700';
      case 'managing_partner': return 'bg-purple-100 text-purple-700';
      case 'executive_managing_partner': return 'bg-purple-100 text-purple-700';
      case 'senior_partner': return 'bg-purple-100 text-purple-700';
      case 'partner': return 'bg-purple-100 text-purple-700';
      case 'executive_partner': return 'bg-purple-100 text-purple-700';
      case 'associate_partner': return 'bg-indigo-100 text-indigo-700';
      case 'executive_associate_partner': return 'bg-indigo-100 text-indigo-700';
      case 'senior_associate': return 'bg-cyan-100 text-cyan-700';
      case 'senior_executive_assistant': return 'bg-cyan-100 text-cyan-700';
      case 'associate': return 'bg-cyan-100 text-cyan-700';
      case 'trainee_associate': return 'bg-sky-100 text-sky-700';
      case 'executive_assistant': return 'bg-green-100 text-green-700';
      case 'originating_attorney': return 'bg-purple-100 text-purple-700';
      case 'intern': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getStatusColor = (isActive: boolean) =>
    isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600';

  const filteredUsers = users.filter(u =>
    u.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const [currentPage, setCurrentPage] = useState(1);
  const usersPerPage = 5;

  // Role hierarchy for sorting
  const roleOrder: Record<string, number> = {
    'intern': 0,
    'trainee_associate': 1,
    'associate': 2,
    'executive_assistant': 3,
    'senior_associate': 4,
    'senior_executive_assistant': 4,
    'associate_partner': 5,
    'executive_associate_partner': 5,
    'partner': 6,
    'managing_partner': 7,
    'executive_managing_partner': 7,
    'senior_partner': 8,
    'executive_partner': 8,
    'originating_attorney': 8,
    'managing_director': 9,
  };

  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const orderA = roleOrder[a.role] ?? 999;
    const orderB = roleOrder[b.role] ?? 999;
    if (orderA !== orderB) return orderA - orderB;
    return a.name?.localeCompare(b.name || '') || 0;
  });

  const paginatedUsers = sortedUsers.slice(
    (currentPage - 1) * usersPerPage,
    currentPage * usersPerPage
  );

  const totalPages = Math.ceil(sortedUsers.length / usersPerPage);

  return (
    <div>
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">User Management</h1>
            <p className="text-gray-600">Manage firm user accounts and system access</p>
          </div>

          {canManageUsers && (
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add User
            </button>
          )}
        </div>

        {/* Alerts */}
        {error && (
          <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded">
            {success}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search users..."
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
          />
        </div>
      </div>

      {loading && <div className="text-center py-8 text-gray-600">Loading users...</div>}

      {!loading && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">No.</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">User</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Role</th>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Status</th>
                  
                  {canManageUsers && (
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">Actions</th>
                  )}
                </tr>
              </thead>

              <tbody className="divide-y divide-gray-200">
                {paginatedUsers.map((u, idx) => (
                  <tr key={u._id} className="hover:bg-gray-50">
                    <td className="px-5 py-4 text-sm text-gray-500">
                      {(currentPage - 1) * usersPerPage + idx + 1}
                    </td>
                    <td className="px-5 py-4">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{u.name}</p>
                        <p className="text-xs text-gray-500">{u.email}</p>
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`px-2 py-1 text-xs rounded ${getRoleColor(u.role)}`}>
                        {ROLE_DISPLAY_MAP[u.role] || u.role}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <span className={`px-2 py-1 text-xs rounded ${getStatusColor(u.isActive)}`}>
                        {u.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    

                    {canManageUsers && (
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleToggleStatus(u._id, u.isActive)}
                            className={`p-1 ${u.isActive ? 'text-green-600 hover:text-red-600' : 'text-gray-400 hover:text-green-600'}`}
                            title={u.isActive ? 'Deactivate' : 'Activate'}
                          >
                            {u.isActive ? <PowerOff className="w-4 h-4" /> : <Power className="w-4 h-4" />}
                          </button>

                          <button
                            className="p-1 text-gray-600 hover:text-blue-600"
                            title="Reset Password"
                            onClick={() => { setSelectedUser(u); setShowResetModal(true); }}
                          >
                            <Key className="w-4 h-4" />
                          </button>

                          <button
                            className="p-1 text-gray-600 hover:text-gray-900"
                            title="Edit"
                            onClick={() => {
                              setSelectedUser(u);
                              setEditForm({ name: u.name, email: u.email, role: u.role });
                              setShowEditModal(true);
                            }}
                          >
                            <Edit className="w-4 h-4" />
                          </button>

                          <button
                            className="p-1 text-red-600 hover:text-red-900"
                            title="Delete"
                            onClick={() => handleDeleteUser(u._id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex justify-center items-center gap-2 mt-4 pb-4">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Prev
              </button>
              {[...Array(totalPages)].map((_, i) => (
                <button
                  key={i}
                  onClick={() => setCurrentPage(i + 1)}
                  className={`px-3 py-1 border rounded ${currentPage === i + 1 ? 'bg-gray-800 text-white' : ''}`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="px-3 py-1 border rounded disabled:opacity-50"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}

      {/* Stats */}
      <div className="mt-6 flex flex-wrap gap-4">
        <div className="flex-1 min-w-[140px] bg-white border border-gray-200 rounded-lg p-4 text-center">
          <div className="text-sm text-gray-600 mb-1">Active Users</div>
          <div className="text-2xl font-semibold text-green-600">
            {users.filter((x) => x.isActive).length}
          </div>
        </div>

        {ROLE_OPTIONS.map(opt => (
          <div key={opt.value} className="flex-1 min-w-[140px] bg-white border border-gray-200 rounded-lg p-4 text-center">
            <div className="text-sm text-gray-600 mb-1">{opt.label}s</div>
            <div className="text-2xl font-semibold text-gray-900">
              {users.filter((x) => x.role === opt.value).length}
            </div>
          </div>
        ))}
      </div>

      {/* Add User Modal */}
      {canManageUsers && showAddModal && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center mb-4">
              <UserPlus className="w-6 h-6 text-gray-700 mr-2" />
              <h3 className="text-lg font-semibold text-gray-900">Add New User</h3>
            </div>

            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm">
                {error}
              </div>
            )}

            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Enter user Full name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="Enter user Email"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={form.role}
                  onChange={(e) => setForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  {ROLE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Initial Password</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm(f => ({ ...f, password: e.target.value }))}
                  required
                  minLength={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="••••••••"
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
                >
                  Add User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {canManageUsers && showEditModal && selectedUser && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center mb-4">
              <Edit className="w-6 h-6 text-gray-700 mr-2" />
              <h3 className="text-lg font-semibold text-gray-900">Edit User</h3>
            </div>

            <form onSubmit={handleEditUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={editForm.name || ''}
                  onChange={(e) => setEditForm(f => ({ ...f, name: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                <input
                  type="email"
                  value={editForm.email || ''}
                  onChange={(e) => setEditForm(f => ({ ...f, email: e.target.value }))}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  value={editForm.role || ''}
                  onChange={(e) => setEditForm(f => ({ ...f, role: e.target.value }))}
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                >
                  {ROLE_OPTIONS.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowEditModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {canManageUsers && showResetModal && selectedUser && (
        <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div className="flex items-center mb-4">
              <Key className="w-6 h-6 text-gray-700 mr-2" />
              <h3 className="text-lg font-semibold text-gray-900">Reset Password</h3>
            </div>

            <form onSubmit={handleResetUserPassword} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">New Password</label>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  required
                  minLength={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-400"
                  placeholder="••••••••"
                />
              </div>

              <div className="flex gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => setShowResetModal(false)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-gray-800 text-white rounded hover:bg-gray-700"
                >
                  Reset Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
