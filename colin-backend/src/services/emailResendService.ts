import { Resend } from 'resend';

export type SendEmailResult =
  | { ok: true; id?: string }
  | { ok: false; error: string };

export const sendEmailResend = async (to: string[], subject: string, html: string): Promise<SendEmailResult> => {
  try {
    const apiKey = String(process.env.RESEND_API_KEY || '').trim();
    const from = String(process.env.EMAIL_FROM || '').trim();

    if (!apiKey) return { ok: false, error: 'Missing RESEND_API_KEY' };
    if (!from) return { ok: false, error: 'Missing EMAIL_FROM' };

    const resend = new Resend(apiKey);

    const resp = await resend.emails.send({
      from,
      to,
      subject,
      html,
    });

    const anyResp: any = resp;
    if (anyResp?.error) return { ok: false, error: anyResp.error.message || 'Resend send failed' };

    return { ok: true, id: anyResp?.data?.id };
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Resend send failed' };
  }
};