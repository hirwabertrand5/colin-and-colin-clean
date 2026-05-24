import { useState, useEffect, useMemo } from 'react';
import { X } from 'lucide-react';
import { createProspect, updateProspect, Prospect } from '../../services/prospectService';
import { LEGAL_SERVICES_TREE } from '../../constants/legalServicesTree';
import { getAllUsers, User } from '../../services/userService';

interface ProspectFormProps {
  prospect?: Prospect | null;
  onClose: () => void;
}

const STAGES = ['Inquiry', 'Consultation', 'Conflict Check', 'Quotation', 'Engagement', 'Non-Converted'];
const CONFLICT_STATUSES = ['Pending', 'Cleared', 'Flagged'];
const SERVICE_LEVEL_LABELS = ['Legal Service', 'Category', 'Practice Area', 'Service Line', 'Sub-category', 'Detail'];

export default function ProspectForm({ prospect, onClose }: ProspectFormProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [services, setServices] = useState<Array<{ id: string; label: string }>>([]);
  const [servicePath, setServicePath] = useState<string[]>(
    prospect?.legalServicePath ? prospect.legalServicePath.map((p) => p.id) : []
  );
  const [form, setForm] = useState({
    clientName: prospect?.clientName || '',
    contact: {
      name: prospect?.contact.name || '',
      email: prospect?.contact.email || '',
      phone: prospect?.contact.phone || '',
    },
    legalServicePath: prospect?.legalServicePath || [],
    inquiryDescription: prospect?.inquiryDescription || '',
    stage: prospect?.stage || 'Inquiry',
    engagementNotes: prospect?.engagementNotes || '',
    assignedTo: prospect?.assignedTo || '',
  });

  useEffect(() => {
    loadUsers();
    buildServicePaths();
  }, []);

  useEffect(() => {
    // keep form legalServicePath in sync when editing an existing prospect
    if (prospect?.legalServicePath) {
      setServicePath(prospect.legalServicePath.map((p) => p.id));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prospect]);

  const findNode = (nodes: any[], id: string) => nodes.find((n) => n.id === id);

  const selectedServiceNodes = useMemo(() => {
    const nodes: any[] = [];
    let currentNodes = LEGAL_SERVICES_TREE;
    for (const id of servicePath) {
      const match = findNode(currentNodes, id);
      if (!match) break;
      nodes.push(match);
      currentNodes = match.children || [];
    }
    return nodes;
  }, [servicePath]);

  const serviceLevels = useMemo(() => {
    const levels: Array<{ label: string; options: any[]; value: string; placeholder: string }> = [];
    let currentOptions: any[] = LEGAL_SERVICES_TREE;
    let depth = 0;
    while (currentOptions.length > 0) {
      levels.push({
        label: SERVICE_LEVEL_LABELS[depth] || `Level ${depth + 1}`,
        options: currentOptions,
        value: servicePath[depth] || '',
        placeholder: depth === 0 ? 'Select...' : `Select ${SERVICE_LEVEL_LABELS[depth - 1].toLowerCase()} first`,
      });

      const selectedNode = servicePath[depth] ? findNode(currentOptions, servicePath[depth]) : undefined;
      if (!selectedNode?.children?.length) break;

      currentOptions = selectedNode.children;
      depth += 1;
    }
    return levels;
  }, [servicePath]);

  const updateServicePathAtLevel = (levelIndex: number, value: string) => {
    setServicePath((prev) => {
      const next = prev.slice(0, levelIndex);
      if (value) next[levelIndex] = value;
      return next;
    });
  };

  useEffect(() => {
    const legalServicePath = selectedServiceNodes.map((node) => ({ id: node.id, label: node.label }));
    setForm((prev) => ({ ...prev, legalServicePath }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServiceNodes]);

  const loadUsers = async () => {
    try {
      const data = await getAllUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users:', err);
    }
  };

  const buildServicePaths = () => {
    const paths: Array<{ id: string; label: string }> = [];
    const collectPaths = (node: any, path: string[] = []) => {
      if (node.label) {
        path = [...path, node.label];
        paths.push({ id: node.id, label: path.join(' / ') });
      }
      if (node.children) {
        node.children.forEach((child: any) => collectPaths(child, path));
      }
    };
    LEGAL_SERVICES_TREE.forEach((node) => collectPaths(node));
    setServices(paths);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const data = { ...form };

      if (prospect) {
        await updateProspect(prospect._id, data);
      } else {
        await createProspect(data);
      }

      onClose();
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to save prospect');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg max-w-lg w-full flex flex-col shadow-xl" style={{ maxHeight: '90vh' }}>
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {prospect ? 'Edit Prospect' : 'New Prospect'}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              Capture essential client intake details and keep the prospect workflow focused.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-6 h-6 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
          {error && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded">
              <p className="text-sm text-red-700 dark:text-red-200">{error}</p>
            </div>
          )}

          {/* Client Information */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Client Information</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Client Name *
                </label>
                <input
                  type="text"
                  required
                  value={form.clientName}
                  onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Contact Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.contact.name}
                    onChange={(e) => setForm({ ...form, contact: { ...form.contact, name: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                {/* Position removed to simplify form */}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={form.contact.email}
                    onChange={(e) => setForm({ ...form, contact: { ...form.contact, email: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Phone *
                  </label>
                  <input
                    type="tel"
                    required
                    value={form.contact.phone}
                    onChange={(e) => setForm({ ...form, contact: { ...form.contact, phone: e.target.value } })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Legal Service */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Legal Service Category
            </label>
            <div className="grid gap-3">
              {serviceLevels.map((level, idx) => (
                <div key={level.label}>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{level.label}</label>
                  <select
                    value={level.value}
                    onChange={(e) => updateServicePathAtLevel(idx, e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Select...</option>
                    {level.options.map((opt: any) => (
                      <option key={opt.id} value={opt.id}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              {form.legalServicePath.length > 0 && (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">{form.legalServicePath.map((p) => p.label).join(' / ')}</p>
              )}
            </div>
          </div>

          {/* Inquiry Details */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Inquiry Details</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Inquiry Description *
                </label>
                <textarea
                  required
                  rows={4}
                  value={form.inquiryDescription}
                  onChange={(e) => setForm({ ...form, inquiryDescription: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Current Stage *
                  </label>
                  <select
                    required
                    value={form.stage}
                    onChange={(e) => setForm({ ...form, stage: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {STAGES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Conflict Check removed to simplify intake — handled separately in workflow */}

          {/* Engagement */}
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Engagement</h3>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Assigned To *
              </label>
              <select
                required
                value={form.assignedTo}
                onChange={(e) => setForm({ ...form, assignedTo: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select staff member...</option>
                {users.map((u) => (
                  <option key={u._id} value={u._id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Engagement Notes
              </label>
              <textarea
                rows={3}
                value={form.engagementNotes}
                onChange={(e) => setForm({ ...form, engagementNotes: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-200 dark:border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving...' : prospect ? 'Update Prospect' : 'Create Prospect'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
