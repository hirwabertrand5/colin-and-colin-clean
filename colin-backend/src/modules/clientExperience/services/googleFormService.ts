import type { IFeedbackRequest } from '../../../models/clientExperience/feedbackRequestModel';
import type { IFeedbackTemplate } from '../../../models/clientExperience/feedbackTemplateModel';

const normalizeBaseUrl = (value?: string) => {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  return trimmed.replace(/\/$/, '');
};

export const googleFormService = {
  getTemplateSurveyUrl(template?: IFeedbackTemplate | null) {
    const configured = normalizeBaseUrl(template?.googleFormUrl);
    if (configured) return configured;

    const formId = String(template?.googleFormId || '').trim();
    if (formId) {
      return `https://docs.google.com/forms/d/e/${encodeURIComponent(formId)}/viewform`;
    }

    return '';
  },

  buildPrefilledUrl(template: IFeedbackTemplate | null | undefined, request: IFeedbackRequest) {
    const baseUrl = this.getTemplateSurveyUrl(template);
    if (!baseUrl) return '';

    const url = new URL(baseUrl);
    url.searchParams.set('usp', 'pp_url');
    url.searchParams.set('feedbackRequestId', String((request as any)._id || (request as any).id || ''));
    url.searchParams.set('feedbackToken', String(request.uniqueToken || ''));
    url.searchParams.set('feedbackType', String(request.feedbackType || ''));
    if (request.clientId) url.searchParams.set('clientId', String(request.clientId));
    if (request.prospectId) url.searchParams.set('prospectId', String(request.prospectId));
    if (request.matterId) url.searchParams.set('matterId', String(request.matterId));
    if (request.clientEmail) url.searchParams.set('clientEmail', String(request.clientEmail));

    return url.toString();
  },
};

export type GoogleFormService = typeof googleFormService;
