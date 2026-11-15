import { ARTICLES_GROUPS, CLIENT_FIELDS, INTAKE_SERVICES, MATTER_FIELDS, PARTY_EXTRA_FIELDS, SHAREHOLDER_FIELDS, INTAKE_CONFIRMATION, IntakeQuestion } from '../config/digitalIntakeSchema';

export class IntakeError extends Error {
  constructor(public status: number, message: string, public code = 'INVALID_REQUEST') { super(message); }
}
export const textValue = (value: unknown, max = 300, required = false): string => {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw new IntakeError(400, 'A text field has an invalid value.');
  const valueText = value.trim();
  if (valueText.length > max || (required && !valueText)) throw new IntakeError(400, `A required field is missing or exceeds ${max} characters.`);
  return valueText;
};
export const validateEmail = (value: unknown, required = false) => {
  const email = textValue(value, 254, required).toLowerCase();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new IntakeError(400, 'Enter a valid email address.');
  return email;
};
export const serviceById = (id: unknown, required = false) => {
  const key = textValue(id, 150, required);
  const match = INTAKE_SERVICES.find(s => s.id === key);
  if (key && !match) throw new IntakeError(400, 'Select a listed legal service.');
  return match;
};
export const normalizeIntakePhone = (value: string, country = '') => {
  const digits = value.replace(/\D/g, '');
  if (!/^\+?[\d\s().-]+$/.test(value) || digits.length < 7 || digits.length > 15) throw new IntakeError(400, 'Enter a telephone number with 7 to 15 digits.');
  if (/^(rwanda|rw)$/i.test(country.trim()) && /^0\d{9}$/.test(digits)) return `+250${digits.slice(1)}`;
  return `${value.startsWith('+') || digits.startsWith('250') ? '+' : ''}${digits}`;
};
const fieldsFrom = (raw: any, questions: IntakeQuestion[]) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new IntakeError(400, 'Form information is invalid.');
  const out: Record<string, string | number> = {};
  for (const question of questions) {
    const value = raw[question.key];
    if (question.type === 'number') {
      if (value === '' || value == null) continue;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (question.max ?? 1000000000000000)) throw new IntakeError(400, `${question.label} has an invalid number.`);
      out[question.key] = value;
    } else out[question.key] = textValue(value, question.type === 'textarea' ? 15000 : 500, question.required);
  }
  return out;
};
const person = (raw: any, client = false) => {
  if (!['Individual', 'Company'].includes(raw?.type)) throw new IntakeError(400, 'Choose Individual or Company / Organization.');
  const fields = fieldsFrom(raw, [...CLIENT_FIELDS, ...(client ? [] : PARTY_EXTRA_FIELDS)]);
  if (!fields.name) throw new IntakeError(400, 'A full legal name or company name is required.');
  fields.email = validateEmail(fields.email, client);
  if (client && (!fields.phone || !fields.country)) throw new IntakeError(400, 'Telephone number and country are required.');
  if (fields.phone) fields.phone = normalizeIntakePhone(String(fields.phone), String(fields.country || ''));
  if (fields.contactPhone) fields.contactPhone = normalizeIntakePhone(String(fields.contactPhone), String(fields.country || ''));
  if (client && raw.type === 'Individual' && !fields.identification) throw new IntakeError(400, 'National ID / Passport number is required.');
  if (raw.type === 'Individual') { delete fields.tin; delete fields.representativeName; delete fields.representativeIdentification; }
  const registrationStatus = raw.registrationStatus === 'Proposed' ? 'Proposed' : 'Registered';
  if (client && raw.type === 'Company' && ((!fields.tin && registrationStatus === 'Registered') || !fields.representativeName || !fields.representativeIdentification)) throw new IntakeError(400, 'Company TIN (for registered businesses) and authorized representative details are required.');
  const identityType = raw.identityType || 'National ID';
  if (!['National ID', 'Passport'].includes(identityType)) throw new IntakeError(400, 'Choose National ID or Passport.');
  return { type: raw.type, ...fields, ...(client ? { identityType, ...(raw.type === 'Company' ? { registrationStatus } : {}) } : {}) };
};
export const validateIntakeForm = (raw: any, link: any) => {
  if (!raw || typeof raw !== 'object') throw new IntakeError(400, 'Complete the intake form.');
  const service = serviceById(raw.serviceId || link.serviceId, true)!;
  if (link.serviceId && !service.path.some(p => p.id === link.serviceId)) throw new IntakeError(400, 'This invitation is for a different legal service.');
  if (INTAKE_SERVICES.some(item => item.path.some(p => p.id === service.id) && item.id !== service.id)) throw new IntakeError(400, 'Complete the legal service decision tree.');
  const questionnaireId = textValue(raw.questionnaireId || link.questionnaireId, 100);
  if (questionnaireId && (questionnaireId !== 'articles-of-association-v1' || !service.path.some(p => p.id === 'company_incorporation'))) throw new IntakeError(400, 'This questionnaire is not available for the selected service.');
  const client = person(raw.client, true);
  if (!Array.isArray(raw.parties) || raw.parties.length > 20) throw new IntakeError(400, 'Up to 20 relevant parties are supported.');
  const matter = fieldsFrom(raw.matter, MATTER_FIELDS);
  if (matter.deadline && (!/^\d{4}-\d{2}-\d{2}$/.test(String(matter.deadline)) || !Number.isFinite(Date.parse(String(matter.deadline))))) throw new IntakeError(400, 'Enter a valid deadline.');
  const parties = raw.parties.map((p: any) => person(p));
  let answers: any = {};
  let shareholders: any[] = [];
  if (questionnaireId) {
    const source = raw.answers || {};
    if (source.appointSecretary !== undefined && typeof source.appointSecretary !== 'boolean') throw new IntakeError(400, 'Choose whether a Company Secretary is proposed.');
    answers = fieldsFrom(source, ARTICLES_GROUPS.filter(g => !g.condition || source[g.condition] === true).flatMap(g => g.questions));
    answers.appointSecretary = source.appointSecretary === true;
    if (!Array.isArray(raw.shareholders) || raw.shareholders.length > 100) throw new IntakeError(400, 'Up to 100 shareholders are supported.');
    shareholders = raw.shareholders.map((shareholder: any) => {
      const row = fieldsFrom(shareholder, SHAREHOLDER_FIELDS);
      if (!row.name) throw new IntakeError(400, 'Each shareholder needs a full legal name.');
      if (row.shares !== undefined && !Number.isInteger(row.shares)) throw new IntakeError(400, 'Number of shares must be a whole number.');
      return row;
    });
  }
  if (raw.confirmationVersion !== undefined && raw.confirmationVersion !== INTAKE_CONFIRMATION.version) throw new IntakeError(400, 'Refresh the form and confirm your details before submitting.');
  if (raw.acknowledged !== true || raw.noticeVersion !== link.notice.version) throw new IntakeError(400, raw.confirmationVersion ? 'Confirm your details and request a review before submitting.' : 'Read and acknowledge the current privacy notice before submitting.');
  return { client, parties, matter, serviceId: service.id, questionnaireId, answers, shareholders };
};
