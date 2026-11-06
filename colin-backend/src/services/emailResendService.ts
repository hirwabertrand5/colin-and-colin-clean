import { Resend } from 'resend';

export type EmailFailureCode = 'EMAIL_NOT_CONFIGURED' | 'EMAIL_SENDER_INVALID' | 'EMAIL_CREDENTIALS_INVALID' | 'EMAIL_DOMAIN_UNVERIFIED' | 'EMAIL_TEST_MODE' | 'EMAIL_RATE_LIMITED' | 'EMAIL_RECIPIENT_INVALID' | 'EMAIL_PROVIDER_UNAVAILABLE' | 'EMAIL_REJECTED';
export type SendEmailResult = { ok: true; id: string } | { ok: false; code: EmailFailureCode; error: string; retryable: boolean };
const failure = (code: EmailFailureCode, error: string, retryable = false): Extract<SendEmailResult, { ok: false }> => ({ ok: false, code, error, retryable });
const senderAddress = (from: string) => from.match(/<([^<>]+)>\s*$/)?.[1]?.trim() || from;
export const validEmail = (value: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value);

/** Staff diagnostics contain no credentials, recipient contents or provider response bodies. */
export const getEmailConfiguration = () => {
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  const from = String(process.env.EMAIL_FROM || '').trim();
  const missing = [!apiKey ? 'RESEND_API_KEY' : '', !from ? 'EMAIL_FROM' : ''].filter(Boolean);
  if (missing.length) return { configured: false as const, code: 'EMAIL_NOT_CONFIGURED' as const, message: `Email sending is not configured. An administrator must set ${missing.join(' and ')} on the backend service. You can still copy and share the link.` };
  if (apiKey === 'your_private_key' || /^your[_-]|^re_xxx/i.test(apiKey)) return { configured: false as const, code: 'EMAIL_NOT_CONFIGURED' as const, message: 'Replace the placeholder RESEND_API_KEY on the backend service with a real Resend sending key.' };
  if (!validEmail(senderAddress(from))) return { configured: false as const, code: 'EMAIL_SENDER_INVALID' as const, message: 'The configured sender address is invalid. An administrator must correct EMAIL_FROM on the backend service.' };
  if (process.env.EMAIL_REPLY_TO && !validEmail(process.env.EMAIL_REPLY_TO.trim())) return { configured: false as const, code: 'EMAIL_SENDER_INVALID' as const, message: 'Correct EMAIL_REPLY_TO on the backend service.' };
  return { configured: true as const, code: null, message: 'Email service configured. The sending domain must be verified with Resend.' };
};

export const classifyEmailFailure = (error: { name?: string; message?: string; statusCode?: number | null }): Extract<SendEmailResult, { ok: false }> => {
  const name = String(error?.name || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();
  if (name === 'invalid_api_key' || name === 'missing_api_key' || error.statusCode === 401 || /api key.*(invalid|expired|revoked)|invalid.*api.?key/.test(message)) return failure('EMAIL_CREDENTIALS_INVALID', 'The email service rejected its credentials. An administrator must update RESEND_API_KEY on the backend service.');
  if (/only.*(send|testing).*own|testing emails|test mode|resend\.dev/.test(message)) return failure('EMAIL_TEST_MODE', 'The email service is restricted to test recipients. Verify the firm’s sending domain in Resend and use an address from that domain in EMAIL_FROM.');
  if (/domain.*(not verified|unverified|not found)|verify.*domain/.test(message)) return failure('EMAIL_DOMAIN_UNVERIFIED', 'The sender domain is not verified. An administrator must verify it in Resend and set EMAIL_FROM to an address on that domain.');
  if (error.statusCode === 429 || /rate_limit|quota|daily_quota|monthly_quota/.test(name) || /quota|rate limit/.test(message)) return failure('EMAIL_RATE_LIMITED', 'The email service has reached its sending limit. Retry later or ask an administrator to check the sending quota.', true);
  if (/recipient|invalid.*to|to.*invalid/.test(message)) return failure('EMAIL_RECIPIENT_INVALID', 'The email service rejected the recipient address. Check the client’s email address or copy the link to share it directly.');
  if (/from.*(invalid|required)|sender.*invalid/.test(message)) return failure('EMAIL_SENDER_INVALID', 'The email service rejected the sender address. An administrator must correct EMAIL_FROM and verify its domain.');
  if ((error.statusCode || 0) >= 500 || /application_error|internal_server_error|timeout|fetch|network/.test(name + ' ' + message)) return failure('EMAIL_PROVIDER_UNAVAILABLE', 'The email provider could not be reached or is temporarily unavailable. Retry sending; the link remains available to copy.', true);
  return failure('EMAIL_REJECTED', 'The email provider rejected this invitation. Ask an administrator to check Resend delivery logs. You can still copy and share the link.');
};

export const sendEmailResend = async (to: string[], subject: string, html: string, options?: { idempotencyKey?: string }): Promise<SendEmailResult> => {
  const configuration = getEmailConfiguration();
  if (!configuration.configured) return failure(configuration.code, configuration.message);
  if (!to.length || to.some(address => !validEmail(address.trim()))) return failure('EMAIL_RECIPIENT_INVALID', 'Enter a valid recipient email address before sending.');
  try {
    const resend = new Resend(String(process.env.RESEND_API_KEY).trim());
    const response = await resend.emails.send({ from: String(process.env.EMAIL_FROM).trim(), to: to.map(address => address.trim()), subject, html, ...(process.env.EMAIL_REPLY_TO ? { replyTo: process.env.EMAIL_REPLY_TO.trim() } : {}) }, options);
    if (response.error) return classifyEmailFailure(response.error);
    if (!response.data?.id) return failure('EMAIL_PROVIDER_UNAVAILABLE', 'The email provider did not confirm the send. Please retry; the same invitation link remains available.', true);
    return { ok: true, id: response.data.id };
  } catch (error: any) { return classifyEmailFailure(error); }
};
