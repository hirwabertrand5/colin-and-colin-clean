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
  const title = escapeEmailHtml(notification.title);
  const message = escapeEmailHtml(notification.message).replace(/\r?\n/g, '<br>');
  return `<!doctype html><html><body style="margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#172033"><div style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #e5e7eb;border-radius:8px"><div style="padding:24px;background:#172033;color:#fff;font-size:18px">Colin &amp; Colin Legal Solutions</div><div style="padding:28px"><p style="font-size:12px;color:#64748b">PLATFORM NOTIFICATION${notification.severity === 'critical' ? ' · ACTION REQUIRED' : ''}</p><h1 style="font-size:22px">${title}</h1><p style="line-height:1.7">${message}</p>${url ? `<p style="margin-top:24px"><a href="${escapeEmailHtml(url)}" style="display:inline-block;background:#172033;color:#fff;padding:12px 20px;text-decoration:none;border-radius:5px">View in platform</a></p>` : ''}<p style="margin-top:30px;font-size:12px;color:#64748b">This message contains confidential firm information. Manage email preferences in your Notification Center. Reply to this email if you need assistance.</p></div></div></body></html>`;
};
