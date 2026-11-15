import { brandedEmail, emailAction } from './emailBranding';
export const escapeEmailHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));

export const absoluteAppLink = (link?: string) => {
  if (!link || !link.startsWith('/') || link.startsWith('//')) return undefined;
  try {
    const base = new URL(process.env.PUBLIC_CLIENT_URL || process.env.CLIENT_URL || '');
    if (!['https:', 'http:'].includes(base.protocol)) return undefined;
    const url = new URL(link, base.origin);
    return url.origin === base.origin ? url.toString() : undefined;
  } catch { return undefined; }
};

export const buildNotificationEmail = (notification: { title: string; message: string; link?: string; severity?: string }) => {
  const url = absoluteAppLink(notification.link);
  const message = escapeEmailHtml(notification.message).replace(/\r?\n/g, '<br>');
  return brandedEmail({ title: notification.title, eyebrow: `PLATFORM NOTIFICATION${notification.severity === 'critical' ? ' · ACTION REQUIRED' : ''}`, preheader: notification.message, bodyHtml: `<p style="font-size:15px;line-height:1.8;color:#334155">${message}</p>${url ? emailAction('View in platform', url) : ''}`, note: 'This message contains confidential firm information. Manage email preferences in your Notification Center. Reply to this email if you need assistance.' });
};
