import fs from 'fs';
import path from 'path';

export interface IntakeAutomationConfig {
  googleFormBaseUrl: string;
  googleFormEntryId: string;
}

const envFilePath = path.resolve(process.cwd(), '.env');

export const getIntakeAutomationConfig = (): IntakeAutomationConfig => ({
  googleFormBaseUrl: String(process.env.GOOGLE_FORM_BASE_URL || 'https://google.com').trim(),
  googleFormEntryId: String(process.env.GOOGLE_FORM_ENTRY_ID || 'entry.123456789').trim(),
});

export const buildGoogleFormSubmissionUrl = (prospectId: string): string => {
  const { googleFormBaseUrl, googleFormEntryId } = getIntakeAutomationConfig();
  const base = googleFormBaseUrl || 'https://google.com';
  const entryId = googleFormEntryId || 'entry.123456789';
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}${entryId}=${encodeURIComponent(prospectId)}`;
};

export const updateIntakeAutomationConfig = (updates: Partial<IntakeAutomationConfig>) => {
  const current = getIntakeAutomationConfig();
  const next = {
    googleFormBaseUrl: updates.googleFormBaseUrl?.trim() || current.googleFormBaseUrl,
    googleFormEntryId: updates.googleFormEntryId?.trim() || current.googleFormEntryId,
  };

  const envContent = fs.existsSync(envFilePath) ? fs.readFileSync(envFilePath, 'utf8') : '';
  const lines = envContent.split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith('GOOGLE_FORM_BASE_URL=') && !trimmed.startsWith('GOOGLE_FORM_ENTRY_ID=');
  });

  lines.push(`GOOGLE_FORM_BASE_URL=${next.googleFormBaseUrl}`);
  lines.push(`GOOGLE_FORM_ENTRY_ID=${next.googleFormEntryId}`);
  fs.writeFileSync(envFilePath, `${lines.join('\n')}\n`);

  process.env.GOOGLE_FORM_BASE_URL = next.googleFormBaseUrl;
  process.env.GOOGLE_FORM_ENTRY_ID = next.googleFormEntryId;

  return next;
};
