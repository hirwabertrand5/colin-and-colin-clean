import { TpaManagementDialog } from './TpaManagement';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState, useRef, useMemo } from 'react';
import { Search, Plus, Edit, UserPlus, Power, PowerOff, Key, Trash2, X } from 'lucide-react';
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
import SortableHeader from '../ui/SortableHeader';
import TableExport from '../ui/TableExport';
import { sortRows, SortDir } from '../../utils/tableSort';
import { StructuredFormField } from '../ui/StructuredForm';
import './user-management.css';

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
  const [tpaUser, setTpaUser] = useState<User | null>(null);
  const [accountModal, setAccountModal] = useState<'add' | 'edit' | 'reset' | null>(null);
  const [savingUser, setSavingUser] = useState(false);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
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

  const openAccountModal = (kind: 'add' | 'edit' | 'reset', user?: User) => {
    setTpaUser(null);
    setError('');
    setSuccess('');
    setSelectedUser(user || null);
    if (kind === 'edit' && user) setEditForm({ name: user.name, email: user.email, role: user.role });
    if (kind === 'reset') setResetPassword('');
    setAccountModal(kind);
  };

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
      setAccountModal(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManageUsers) return;
    if (!selectedUser) return;
    if (savingUser) return;

    setError('');
    setSuccess('');
    setSavingUser(true);
    try {
      const updatedUser = await editUser(selectedUser._id, {
        name: editForm.name || '', email: editForm.email || '', role: editForm.role || '',
      });
      setUsers(current => current.map(user => user._id === updatedUser._id ? updatedUser : user));
      setSuccess('User updated successfully!');
      setAccountModal(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingUser(false);
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
      setAccountModal(null);
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
  const [sortKey, setSortKey] = useState('');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const handleSort = (column: string) => {
    if (sortKey === column) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(column);
      setSortDir('asc');
    }
  };

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

  const userSortValueOf = (u: any, key: string): unknown => {
    switch (key) {
      case 'name':
        return u?.name || '';
      case 'email':
        return u?.email || '';
      case 'role':
        return roleOrder[u?.role] ?? 999;
      case 'status':
        return u?.isActive === false ? 1 : 0;
      default:
        return u?.name || '';
    }
  };

  const sortedUsersFinal = sortRows(sortedUsers, sortKey, sortDir, (u) => userSortValueOf(u, sortKey));

  const paginatedUsers = sortedUsersFinal.slice(
    (currentPage - 1) * usersPerPage,
    currentPage * usersPerPage
  );

  const totalPages = Math.ceil(sortedUsersFinal.length / usersPerPage);
  useEffect(() => {
    setCurrentPage((page) => Math.min(page, Math.max(1, totalPages)));
  }, [totalPages]);

  return (
    <div>
      {tpaUser && <TpaManagementDialog user={tpaUser} onClose={() => setTpaUser(null)} />}
      {/* Page Header */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1">User Management</h1>
            <p className="text-gray-600">Manage firm user accounts and system access</p>
          </div>

          {['managing_partner', 'managing_director', 'executive_assistant'].includes(currentRole || '') && <select aria-label="Manage staff TPA" className="border rounded p-2" value="" onChange={e => {
            setAccountModal(null);
            setSelectedUser(null);
            setError('');
            setTpaUser(users.find(u => u._id === e.target.value) || null);
          }}><option value="">Manage Staff TPA...</option>{users.map(u => <option key={u._id} value={u._id}>{u.name}</option>)}</select>}
          {canManageUsers && (
            <button
              onClick={() => openAccountModal('add')}
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
        {filteredUsers.length > 0 && (
          <TableExport
            filename="user_management"
            title="User Management"
            subtitle={`${filteredUsers.length} users`}
            columns={[
              { label: 'User', value: (u: any) => u?.name || '' },
              { label: 'Email', value: (u: any) => u?.email || '' },
              { label: 'Role', value: (u: any) => u?.role || '' },
              { label: 'Status', value: (u: any) => (u?.isActive === false ? 'Inactive' : 'Active') },
            ]}
            rows={filteredUsers}
          />
        )}
      </div>

      {loading && <div className="text-center py-8 text-gray-600">Loading users...</div>}

      {!loading && (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-[900px] w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-5 py-3 text-left text-xs font-medium text-gray-700 uppercase tracking-wider">No.</th>
                  <SortableHeader label="User" column="name" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-5 py-3 text-xs font-medium text-gray-700 uppercase tracking-wider" />
                  <SortableHeader label="Role" column="role" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-5 py-3 text-xs font-medium text-gray-700 uppercase tracking-wider" />
                  <SortableHeader label="Status" column="status" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} className="px-5 py-3 text-xs font-medium text-gray-700 uppercase tracking-wider" />
                  
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
                            onClick={() => openAccountModal('reset', u)}
                          >
                            <Key className="w-4 h-4" />
                          </button>

                          <button
                            className="p-1 text-gray-600 hover:text-gray-900"
                            title="Edit"
                            onClick={event => {
                              editTriggerRef.current = event.currentTarget;
                              openAccountModal('edit', u);
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
      {canManageUsers && accountModal === 'add' && (
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
                  onClick={() => setAccountModal(null)}
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
      {canManageUsers && accountModal === 'edit' && selectedUser && (
        <Dialog.Root open onOpenChange={open => { if (!open && !savingUser) setAccountModal(null); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="retainer-modal-backdrop">
              <Dialog.Content className="retainer-modal-card retainer-form user-account-edit-dialog"
                onEscapeKeyDown={event => { if (savingUser) event.preventDefault(); }}
                onPointerDownOutside={event => { if (savingUser) event.preventDefault(); }}
                onCloseAutoFocus={event => { event.preventDefault(); editTriggerRef.current?.focus(); }}>
                <header className="retainer-form-header">
                  <div>
                    <Dialog.Title asChild><h2>Edit User</h2></Dialog.Title>
                    <Dialog.Description asChild><p>Update {selectedUser.name}&apos;s account details.</p></Dialog.Description>
                  </div>
                  <Dialog.Close asChild><button type="button" disabled={savingUser} className="retainer-icon-close" aria-label="Close edit user"><X size={18} /></button></Dialog.Close>
                </header>
                <form onSubmit={handleEditUser} aria-busy={savingUser}>
                  <fieldset disabled={savingUser} className="user-account-edit-fields retainer-form-section">
                    {error && <div role="alert" className="user-account-edit-error">{error}</div>}
                    <StructuredFormField label="Full Name" required>
                      <input type="text" autoComplete="name" value={editForm.name || ''} required className="retainer-form-control"
                        onChange={event => setEditForm(current => ({ ...current, name: event.target.value }))} />
                    </StructuredFormField>
                    <StructuredFormField label="Email Address" required>
                      <input type="email" autoComplete="email" value={editForm.email || ''} required className="retainer-form-control"
                        onChange={event => setEditForm(current => ({ ...current, email: event.target.value }))} />
                    </StructuredFormField>
                    <StructuredFormField label="Role" required>
                      <select value={editForm.role || ''} required className="retainer-form-control"
                        onChange={event => setEditForm(current => ({ ...current, role: event.target.value }))}>
                        {ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </StructuredFormField>
                  </fieldset>
                  <footer className="retainer-form-footer">
                    <Dialog.Close asChild><button type="button" disabled={savingUser} className="retainer-button retainer-button-secondary">Cancel</button></Dialog.Close>
                    <button type="submit" disabled={savingUser} className="retainer-button retainer-button-primary">{savingUser ? 'Saving…' : 'Save Changes'}</button>
                  </footer>
                </form>
              </Dialog.Content>
            </Dialog.Overlay>
          </Dialog.Portal>
        </Dialog.Root>
      )}

      {/* Reset Password Modal */}
      {canManageUsers && accountModal === 'reset' && selectedUser && (
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
                  onClick={() => setAccountModal(null)}
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
