import { readFileSync } from 'node:fs';
import path from 'node:path';

export const EMAIL_LOGO_CID = 'colin-and-colin-logo';
let logoContent: Buffer | undefined;
export const emailLogoAttachment = () => {
  logoContent ||= readFileSync(path.resolve(__dirname, '../../assets/colin-logo.png'));
  return { filename: 'colin-and-colin.png', content: logoContent.toString('base64'), contentType: 'image/png', contentId: EMAIL_LOGO_CID };
};
export const escapeEmailText = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
export const emailParagraph = (text: string) => `<p style="margin:0 0 20px;font-size:15px;line-height:1.8;color:#334155">${escapeEmailText(text).replace(/\r?\n/g, '<br>')}</p>`;
export const emailAction = (label: string, url: string) => `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0"><tr><td bgcolor="#16254a" style="border-radius:5px"><a href="${escapeEmailText(url)}" style="display:inline-block;border:14px solid #16254a;border-left-width:24px;border-right-width:24px;border-radius:5px;color:#ffffff;text-decoration:none;font-family:Arial,sans-serif;font-size:14px;font-weight:bold">${escapeEmailText(label)} &rarr;</a></td></tr></table>`;
export const emailDate = (value: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Kigali', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) + ' (Kigali time)';

/** Table layout, inline styles and an inline PNG work in Outlook and Gmail. */
export const brandedEmail = ({ title, eyebrow, preheader, bodyHtml, note = '' }: { title: string; eyebrow: string; preheader: string; bodyHtml: string; note?: string }) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeEmailText(title)}</title></head>
<body style="margin:0;padding:0;background:#f3f2ef;font-family:Arial,Helvetica,sans-serif;color:#192941">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all">${escapeEmailText(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f3f2ef"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" bgcolor="#ffffff" style="width:100%;max-width:640px;border:1px solid #e1dfda;border-top:4px solid #bea580;border-radius:8px">
<tr><td style="padding:34px 28px 28px"><p style="font-size:10px;font-weight:bold;letter-spacing:2px;color:#9a7a48;margin:0 0 14px">${escapeEmailText(eyebrow)}</p>
<h1 style="font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:normal;line-height:1.25;color:#16254a;margin:0 0 26px">${escapeEmailText(title)}</h1>
${bodyHtml}
${note ? `<p style="font-size:12px;line-height:1.7;color:#657184;border-top:1px solid #e5e7eb;padding-top:20px;margin:26px 0 22px">${escapeEmailText(note)}</p>` : ''}
<p style="font-size:14px;line-height:1.7;color:#334155;margin:24px 0 0">Kind regards,</p></td></tr>
<tr><td bgcolor="#16254a" align="center" style="padding:28px 22px;border-top:2px solid #bea580;border-radius:0 0 7px 7px">
<img src="cid:${EMAIL_LOGO_CID}" width="230" height="62" alt="Colin &amp; Colin Legal Solutions" style="display:block;width:230px;max-width:100%;height:auto;margin:0 auto 19px;border:0">
<p style="font-size:12px;line-height:1.9;color:#e4e7ed;margin:0"><a href="mailto:info@colinandcolin.com" style="color:#ffffff;text-decoration:none">info@colinandcolin.com</a><br><a href="tel:+250788300401" style="color:#e4e7ed;text-decoration:none">+250 788 300 401</a> &nbsp;&middot;&nbsp; Kigali, Rwanda</p>
</td></tr></table></td></tr></table></body></html>`;
