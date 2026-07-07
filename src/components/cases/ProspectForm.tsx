import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { createProspect, updateProspect, Prospect } from '../../services/prospectService';
import { getRoleSuggestions } from '../../constants/partyRoles';
import { getStaffUsers, User } from '../../services/userService';

interface ProspectFormProps {
  prospect?: Prospect | null;
  onClose: () => void;
}

const STAGES = [
  'Inquiry',
  'Consultation',
  'Conflict Check',
  'Quotation',
  'Quotation Preparation',
  'Conversion Assessment',
  'Quotation Issued',
  'Awaiting Client Decision',
  'Final Follow-Up',
  'Engagement',
  'Converted',
  'Non-Converted',
];
const PRACTICE_AREAS = ['Converted', 'Non Converted'] as const;
const ESTIMATED_CURRENCIES = [
  { code: 'RWF', label: 'Rwandan Franc (RWF)' },
  { code: 'USD', label: 'US Dollar (USD)' },
  { code: 'EUR', label: 'Euro (EUR)' },
  { code: 'GBP', label: 'British Pound (GBP)' },
  { code: 'KES', label: 'Kenyan Shilling (KES)' },
  { code: 'UGX', label: 'Ugandan Shilling (UGX)' },
  { code: 'TZS', label: 'Tanzanian Shilling (TZS)' },
] as const;
const PRACTICE_ACTIONS: Record<(typeof PRACTICE_AREAS)[number], string[]> = {
  Converted: ['Quick Advisory', 'Legal Opinion', 'Full Engagement', 'Repeat Client', 'Retainer Client'],
  'Non Converted': ['Pricing', 'Competitor', 'No Response', 'Internal Handling', 'Conflict', 'Other'],
};

const getUserId = (value?: string | { _id: string } | null) => {
  if (!value) return '';
  return typeof value === 'string' ? value : value._id;
};

export default function ProspectForm({ prospect, onClose }: ProspectFormProps) {
  const [users, setUsers] = useState<User[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [partiesStructured, setPartiesStructured] = useState(false);
  const [partiesList, setPartiesList] = useState<Array<{ name: string; role: string }>>(
    prospect?.parties ? [{ name: prospect.parties, role: '' }] : []
  );
  const [form, setForm] = useState({
    clientName: prospect?.clientName || '',
    parties: prospect?.parties || '',
    enquiryNature: prospect?.enquiryNature || '',
    enquirySource: prospect?.enquirySource || '',
    referralSource: prospect?.referralSource || '',
    estimatedMatterValue: prospect?.estimatedMatterValue?.toString() || '',
    estimatedMatterCurrency: prospect?.estimatedMatterCurrency || 'RWF',
    paymentArrangement: prospect?.paymentArrangement || '',
    paymentMethod: prospect?.paymentMethod || '',
    installmentCount: prospect?.installmentCount?.toString() || '',
    depositAmount: prospect?.depositAmount?.toString() || '',
    practiceArea:
      prospect?.practiceArea || (prospect?.stage === 'Converted' ? 'Converted' : prospect?.stage === 'Non-Converted' ? 'Non Converted' : ''),
    subPracticeActions: prospect?.subPracticeActions || (prospect?.conversionOutcome ? [prospect.conversionOutcome] : []),
    contact: {
      name: prospect?.contact.name || prospect?.clientName || '',
      email: prospect?.contact.email || '',
      phone: prospect?.contact.phone || '',
    },
    inquiryDescription: prospect?.inquiryDescription || '',
    stage: prospect?.stage || 'Inquiry',
    engagementNotes: prospect?.engagementNotes || '',
    responsiblePartner: getUserId(prospect?.responsiblePartner),
    responsibleAssociate: getUserId(prospect?.responsibleAssociate || prospect?.assignedTo),
    assignedTo: getUserId(prospect?.responsibleAssociate || prospect?.assignedTo),
  });

  useEffect(() => {
    loadUsers();
  }, []);

  useEffect(() => {
    setForm({
      clientName: prospect?.clientName || '',
      parties: prospect?.parties || '',
      enquiryNature: prospect?.enquiryNature || '',
      enquirySource: prospect?.enquirySource || '',
      referralSource: prospect?.referralSource || '',
      estimatedMatterValue: prospect?.estimatedMatterValue?.toString() || '',
      estimatedMatterCurrency: prospect?.estimatedMatterCurrency || 'RWF',
      paymentArrangement: prospect?.paymentArrangement || '',
      paymentMethod: prospect?.paymentMethod || '',
      installmentCount: prospect?.installmentCount?.toString() || '',
      depositAmount: prospect?.depositAmount?.toString() || '',
      practiceArea:
        prospect?.practiceArea || (prospect?.stage === 'Converted' ? 'Converted' : prospect?.stage === 'Non-Converted' ? 'Non Converted' : ''),
      subPracticeActions: prospect?.subPracticeActions || (prospect?.conversionOutcome ? [prospect.conversionOutcome] : []),
      contact: {
        name: prospect?.contact.name || prospect?.clientName || '',
        email: prospect?.contact.email || '',
        phone: prospect?.contact.phone || '',
      },
      inquiryDescription: prospect?.inquiryDescription || '',
      stage: prospect?.stage || 'Inquiry',
      engagementNotes: prospect?.engagementNotes || '',
      responsiblePartner: getUserId(prospect?.responsiblePartner),
      responsibleAssociate: getUserId(prospect?.responsibleAssociate || prospect?.assignedTo),
      assignedTo: getUserId(prospect?.responsibleAssociate || prospect?.assignedTo),
    });
  }, [prospect]);

  const loadUsers = async () => {
    setUsersLoading(true);
    setUsersError('');
    try {
      const data = await getStaffUsers();
      setUsers(data);
    } catch (err) {
      console.error('Failed to load users:', err);
      setUsersError('Failed to load staff members. Please try again.');
    } finally {
      setUsersLoading(false);
    }
  };

  const validateForm = (): string | null => {
    if (!form.clientName?.trim()) return 'Client name is required.';
    if (form.contact.email?.trim() && !form.contact.email.includes('@')) return 'Please enter a valid email address.';
    if (!form.inquiryDescription?.trim()) return 'Inquiry description is required.';
    if (!form.parties?.trim()) return 'Parties is required.';
    if (!form.stage) return 'Please select a stage.';
    if (!form.responsiblePartner) return 'Please select a responsible partner.';
    if (!form.responsibleAssociate) return 'Please select a responsible associate.';
    const matterValue = Number(form.estimatedMatterValue);
    if (form.estimatedMatterValue && !Number.isFinite(matterValue)) return 'Estimated matter value must be a number.';
    if (!form.estimatedMatterCurrency) return 'Please select a currency for the estimated matter value.';
    if (!form.paymentArrangement) return 'Please select a payment arrangement.';
    if (!form.paymentMethod) return 'Please select a payment method.';
    if (form.paymentArrangement === 'Installments') {
      const installmentCount = Number(form.installmentCount);
      if (!form.installmentCount || !Number.isFinite(installmentCount) || installmentCount < 2) {
        return 'Please enter a valid installment count.';
      }
    }
    if (!form.practiceArea) return 'Please select a practice area.';
    if (!form.subPracticeActions.length) {
      return 'Please select at least one sub-practice area action.';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    // Validate form
    const validationError = validateForm();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);

    try {
      // Ensure we have clean data
      const finalParties = partiesStructured
        ? partiesList.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(' ; ')
        : form.parties;

      const data = {
        clientName: form.clientName.trim(),
        parties: finalParties,
        enquiryNature: form.enquiryNature.trim(),
        enquirySource: form.enquirySource.trim(),
        referralSource: form.referralSource.trim(),
        estimatedMatterValue: form.estimatedMatterValue ? Number(form.estimatedMatterValue) : undefined,
        estimatedMatterCurrency: form.estimatedMatterCurrency || 'RWF',
        paymentArrangement: form.paymentArrangement || undefined,
        paymentMethod: form.paymentMethod || undefined,
        installmentCount: form.installmentCount ? Number(form.installmentCount) : undefined,
        depositAmount: form.depositAmount ? Number(form.depositAmount) : undefined,
        contact: {
          name: form.contact.name.trim() || form.clientName.trim(),
          email: form.contact.email.trim() ? form.contact.email.trim().toLowerCase() : undefined,
          phone: form.contact.phone.trim() || undefined,
        },
        inquiryDescription: form.inquiryDescription.trim(),
        stage: form.stage,
        engagementNotes: form.engagementNotes.trim(),
        practiceArea: form.practiceArea || undefined,
        subPracticeActions: form.subPracticeActions,
        responsiblePartner: form.responsiblePartner,
        responsibleAssociate: form.responsibleAssociate,
        assignedTo: form.responsibleAssociate,
      };

      if (prospect) {
        await updateProspect(prospect._id, data);
      } else {
        await createProspect(data);
      }

      onClose();
    } catch (err: any) {
      console.error('Form submission error:', err);
      const errorMessage = err?.message || err?.response?.data?.message || 'Failed to save prospect';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-5xl w-full flex flex-col shadow-2xl" style={{ maxHeight: '92vh' }}>
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
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
              <p className="text-sm text-red-700 dark:text-red-200">{error}</p>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50/70 p-5 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Client Details</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Prospect number and date received are generated automatically.</p>
                </div>
                <span className="rounded-full border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300">
                  Intake
                </span>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Client Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={form.clientName}
                    onChange={(e) => setForm({ ...form, clientName: e.target.value })}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>

                <div className="md:col-span-2 space-y-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Parties *</label>
                    <label className="inline-flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-gray-300 text-gray-900"
                        checked={partiesStructured}
                        onChange={(e) => setPartiesStructured(e.target.checked)}
                      />
                      Structured
                    </label>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/60">
                    {!partiesStructured ? (
                      <input
                        type="text"
                        value={form.parties}
                        onChange={(e) => setForm({ ...form, parties: e.target.value })}
                        placeholder="e.g., John vs Smith"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      />
                    ) : (
                      <div className="space-y-3">
                        {partiesList.map((p, idx) => (
                          <div
                            key={idx}
                            className="space-y-3 rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40"
                          >
                            <div>
                              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Party Name
                              </label>
                              <input
                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                                placeholder="Party name"
                                value={p.name}
                                onChange={(e) =>
                                  setPartiesList((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                                }
                              />
                            </div>

                            <div>
                              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                Party Role
                              </label>
                              <select
                                value={p.role}
                                onChange={(e) =>
                                  setPartiesList((prev) => prev.map((x, i) => (i === idx ? { ...x, role: e.target.value } : x)))
                                }
                                className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                              >
                                <option value="">Select role...</option>
                                {getRoleSuggestions({ matterType: form.practiceArea }).map((r) => (
                                  <option key={r} value={r}>
                                    {r}
                                  </option>
                                ))}
                              </select>
                            </div>

                            <div className="flex justify-end">
                              <button
                                type="button"
                                onClick={() => setPartiesList((prev) => prev.filter((_, i) => i !== idx))}
                                className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-900/20"
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        ))}

                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => setPartiesList((prev) => [...prev, { name: '', role: '' }])}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                          >
                            Add party
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const preview = partiesList.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join(' ; ');
                              setForm((f) => ({ ...f, parties: preview }));
                            }}
                            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                          >
                            Save as text
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Email <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="email"
                    value={form.contact.email}
                    onChange={(e) => setForm({ ...form, contact: { ...form.contact, email: e.target.value } })}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Telephone <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="tel"
                    value={form.contact.phone}
                    onChange={(e) => setForm({ ...form, contact: { ...form.contact, phone: e.target.value } })}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Matter Details</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Capture the practice area and the business context for the enquiry.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Practice Area *</label>
                  <select
                    value={form.practiceArea}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        practiceArea: e.target.value as any,
                        subPracticeActions: [],
                      })
                    }
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="">Select...</option>
                    {PRACTICE_AREAS.map((area) => (
                      <option key={area} value={area}>
                        {area}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900/40">
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-300">Sub-Practice Area *</div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Select the key actions that apply to the chosen practice area.
                  </p>
                </div>
              </div>

              {form.practiceArea ? (
                <div className="space-y-3 rounded-2xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800/60">
                  {PRACTICE_ACTIONS[form.practiceArea as (typeof PRACTICE_AREAS)[number]].map((action) => {
                    const checked = form.subPracticeActions.includes(action);
                    return (
                      <label key={action} className="flex items-start gap-3 text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setForm((prev) => ({
                              ...prev,
                              subPracticeActions: e.target.checked
                                ? [...prev.subPracticeActions, action]
                                : prev.subPracticeActions.filter((item) => item !== action),
                            }))
                          }
                          className="mt-1 h-4 w-4 rounded border-gray-300 text-gray-900"
                        />
                        <span className="text-gray-700 dark:text-gray-200">{action}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400">
                  Select a practice area to load its sub-practice actions.
                </div>
              )}

              {form.subPracticeActions.length > 0 && (
                <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-900/50 dark:text-gray-300">
                  {form.practiceArea}: {form.subPracticeActions.join(' / ')}
                </p>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Enquiry Nature</label>
                  <input
                    type="text"
                    value={form.enquiryNature}
                    onChange={(e) => setForm({ ...form, enquiryNature: e.target.value })}
                    placeholder="e.g. New instruction, follow-up"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Enquiry Source</label>
                  <input
                    type="text"
                    value={form.enquirySource}
                    onChange={(e) => setForm({ ...form, enquirySource: e.target.value })}
                    placeholder="Website, walk-in, call, event..."
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Referral Source</label>
                  <input
                    type="text"
                    value={form.referralSource}
                    onChange={(e) => setForm({ ...form, referralSource: e.target.value })}
                    placeholder="Referrer name or firm"
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Estimated Matter Value</label>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.estimatedMatterValue}
                      onChange={(e) => setForm({ ...form, estimatedMatterValue: e.target.value })}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    />
                    <select
                      value={form.estimatedMatterCurrency}
                      onChange={(e) => setForm({ ...form, estimatedMatterCurrency: e.target.value as any })}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                      {ESTIMATED_CURRENCIES.map((currency) => (
                        <option key={currency.code} value={currency.code}>
                          {currency.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Payment Arrangement *</label>
                  <select
                    value={form.paymentArrangement}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        paymentArrangement: e.target.value as any,
                        installmentCount: e.target.value === 'Installments' ? form.installmentCount : '',
                        depositAmount: e.target.value === 'Installments' ? form.depositAmount : '',
                      })
                    }
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="">Select...</option>
                    <option value="Full Payment">Full Payment</option>
                    <option value="Installments">Installments</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Payment Method *</label>
                  <select
                    value={form.paymentMethod}
                    onChange={(e) => setForm({ ...form, paymentMethod: e.target.value as any })}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="">Select...</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="Cash">Cash</option>
                    <option value="Mobile Money">Mobile Money</option>
                    <option value="Cheque">Cheque</option>
                    <option value="Card">Card</option>
                    <option value="Mixed">Mixed</option>
                  </select>
                </div>
                {form.paymentArrangement === 'Installments' ? (
                  <>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Number of Installments *</label>
                      <input
                        type="number"
                        min="2"
                        step="1"
                        value={form.installmentCount}
                        onChange={(e) => setForm({ ...form, installmentCount: e.target.value })}
                        placeholder="e.g. 3"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Deposit Amount</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.depositAmount}
                        onChange={(e) => setForm({ ...form, depositAmount: e.target.value })}
                        placeholder="Optional upfront amount"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                      />
                    </div>
                  </>
                ) : (
                  <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-400 md:col-span-2">
                    Full payment selected. The client settles the full amount in a single transaction.
                  </div>
                )}
              </div>
            </section>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Assignment & Workflow</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Choose the accountable team and set the prospect stage.</p>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Responsible Partner *
                  </label>
                  <select
                    required
                    value={form.responsiblePartner}
                    onChange={(e) => setForm({ ...form, responsiblePartner: e.target.value })}
                    disabled={usersLoading}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="">{usersLoading ? 'Loading staff...' : 'Select partner...'}</option>
                    {users.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.name} ({u.role.replace(/_/g, ' ')})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                    Responsible Associate *
                  </label>
                  <select
                    required
                    value={form.responsibleAssociate}
                    onChange={(e) =>
                      setForm({ ...form, responsibleAssociate: e.target.value, assignedTo: e.target.value })
                    }
                    disabled={usersLoading}
                    className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                  >
                    <option value="">{usersLoading ? 'Loading staff...' : 'Select associate...'}</option>
                    {users.map((u) => (
                      <option key={u._id} value={u._id}>
                        {u.name} ({u.role.replace(/_/g, ' ')})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {usersError && <p className="text-xs text-red-600 dark:text-red-300">{usersError}</p>}
              {!usersLoading && !usersError && users.length === 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  No active staff users found. Add users first in Administration → Users.
                </p>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Current Stage *
                </label>
                <select
                  required
                  value={form.stage}
                  onChange={(e) => setForm({ ...form, stage: e.target.value as any })}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                >
                  {STAGES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                  Use a closing stage only after the intake details above have been captured.
                </p>
              </div>
            </section>

            <section className="space-y-4 rounded-2xl border border-gray-200 bg-gray-50/70 p-5 dark:border-gray-700 dark:bg-gray-900/40">
              <div>
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Description & Notes</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400">Keep the enquiry summary short but specific.</p>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Inquiry Description *
                </label>
                <textarea
                  required
                  rows={6}
                  value={form.inquiryDescription}
                  onChange={(e) => setForm({ ...form, inquiryDescription: e.target.value })}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Engagement Notes
                </label>
                <textarea
                  rows={5}
                  value={form.engagementNotes}
                  onChange={(e) => setForm({ ...form, engagementNotes: e.target.value })}
                  className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-gray-900 outline-none focus:ring-2 focus:ring-gray-400 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                />
              </div>
            </section>
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
              disabled={loading || usersLoading}
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
