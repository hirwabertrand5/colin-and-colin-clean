import { ClipboardCheck, History } from 'lucide-react';
import './contribution-badge.css';

export default function ContributionBadge({ kind }: { kind: 'independent' | 'handover' }) {
  const independent = kind === 'independent';
  const Icon = independent ? ClipboardCheck : History;
  return <span className="staff-contribution-badge" title={independent
    ? 'Work completed through Independent Tasks. Its contribution and earned fee remain attributed to this team member.'
    : 'This role was handed over. Previously recorded contributions remain attributed to this team member.'}>
    <Icon aria-hidden="true" />
    <span>{independent ? 'Independent-task contribution' : 'Retained after handover'}</span>
  </span>;
}
