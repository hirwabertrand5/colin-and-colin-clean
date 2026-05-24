import { CaseData } from '../services/caseService';

export const getCasePracticePath = (caseData?: Pick<CaseData, 'legalServicePath' | 'matterType' | 'workflow' | 'caseType'>) => {
  const path = Array.isArray(caseData?.legalServicePath) ? caseData?.legalServicePath : [];
  const labels = path.map((item) => String(item?.label || '').trim()).filter(Boolean);
  return labels.length ? labels.join(' / ') : caseData?.matterType || caseData?.workflow || caseData?.caseType || 'Unclassified';
};
