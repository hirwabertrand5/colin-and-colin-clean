import FeedbackTemplate from '../models/clientExperience/feedbackTemplateModel';

const templates = [
  {
    name: 'Lost Prospect Feedback',
    triggerType: 'LOST_PROSPECT_FEEDBACK',
    description: 'Default template for lost prospect feedback surveys.',
    googleFormUrl: process.env.CLIENT_EXPERIENCE_LOST_PROSPECT_FORM_URL || '',
    googleFormId: process.env.CLIENT_EXPERIENCE_LOST_PROSPECT_FORM_ID || '',
    emailSubject: 'We value your feedback',
    emailBody: 'Thank you for speaking with Colin & Colin. Please complete this short feedback survey to help us improve our service.',
    isActive: true,
  },
  {
    name: 'Mid Matter Feedback',
    triggerType: 'MID_MATTER_FEEDBACK',
    description: 'Default template for mid-matter client experience surveys.',
    googleFormUrl: process.env.CLIENT_EXPERIENCE_MID_MATTER_FORM_URL || '',
    googleFormId: process.env.CLIENT_EXPERIENCE_MID_MATTER_FORM_ID || '',
    emailSubject: 'How is your matter progressing?',
    emailBody: 'We would appreciate a few minutes of your time to let us know how your matter is progressing.',
    isActive: true,
  },
  {
    name: 'Matter Completion Feedback',
    triggerType: 'MATTER_COMPLETION_FEEDBACK',
    description: 'Default template for matter completion feedback surveys.',
    googleFormUrl: process.env.CLIENT_EXPERIENCE_MATTER_COMPLETION_FORM_URL || '',
    googleFormId: process.env.CLIENT_EXPERIENCE_MATTER_COMPLETION_FORM_ID || '',
    emailSubject: 'Tell us about your experience',
    emailBody: 'Thank you for working with Colin & Colin. Please share your experience so we can continue improving our service.',
    isActive: true,
  },
];

export const seedClientExperienceTemplates = async () => {
  for (const template of templates) {
    const existing = await FeedbackTemplate.findOne({ triggerType: template.triggerType });
    if (existing) {
      await FeedbackTemplate.updateOne({ _id: existing._id }, { $set: { ...template, triggerType: template.triggerType } });
      continue;
    }

    await FeedbackTemplate.create(template);
  }
};
