import type { Retainer } from '../../services/retainerService';

const date = (value?: string) => value
  ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`))
  : '';

export function RetainerAgreementOverview({ retainer }: { retainer: Retainer }) {
  return <section className="retainer-accounting ra-agreement-overview" aria-label="Agreement overview">
    <div className="ra-section-heading"><div><h2>Agreement overview</h2><p>The terms and details saved for this retainer.</p></div></div>
    <dl className="ra-agreement-grid">
      <div><dt>Agreement status</dt><dd>{retainer.status}{retainer.effectiveStatus !== retainer.status && <small>Currently {retainer.effectiveStatus.toLowerCase()}</small>}</dd></div>
      <div><dt>Fixed monthly fee</dt><dd>RWF {Number(retainer.monthlyFee || 0).toLocaleString()}<small>Billing day: {retainer.billingDay || 1} of each month</small></dd></div>
      <div><dt>Start date</dt><dd>{date(retainer.startDate)}</dd></div>
      <div><dt>End date</dt><dd>{date(retainer.endDate) || 'Open-ended'}</dd></div>
      <div><dt>Renewal review</dt><dd>{date(retainer.renewalDate) || 'Not scheduled'}</dd></div>
      <div className="ra-agreement-wide"><dt>Services covered</dt><dd>{retainer.scope || 'Not specified'}</dd></div>
      <div className="ra-agreement-wide"><dt>Internal notes</dt><dd>{retainer.notes || 'No internal notes'}</dd></div>
    </dl>
  </section>;
}
