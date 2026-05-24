import { Request, Response } from 'express';
import HelpArticle from '../models/helpArticleModel';
import HelpFaq from '../models/helpFaqModel';

const DEFAULT_CATEGORIES = [
  { id: 'all', label: 'All Topics' },
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'cases', label: 'Case Management' },
  { id: 'tasks', label: 'Tasks & Workflows' },
  { id: 'billing', label: 'Billing & Invoices' },
];

export const listHelpCategories = async (_req: Request, res: Response) => {
  // simple for now; later can be dynamic
  res.json(DEFAULT_CATEGORIES);
};

export const listHelpArticles = async (req: Request, res: Response) => {
  try {
    const { category = 'all', q = '' } = req.query as any;

    const filter: any = { isPublished: true };
    if (category && category !== 'all') filter.category = String(category);

    let query = HelpArticle.find(filter);

    const search = String(q || '').trim();
    if (search) {
      // Use text index
      query = HelpArticle.find({ ...filter, $text: { $search: search } });
    }

    const items = await query
      .sort({ order: 1, createdAt: -1 })
      .select('_id title description category type updatedAt')
      .lean();

    res.json(items);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to load help articles.' });
  }
};

export const getHelpArticleById = async (req: Request, res: Response) => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    if (!id) return res.status(400).json({ message: 'Missing article id.' });

    const item = await HelpArticle.findOne({ _id: id, isPublished: true }).lean();
    if (!item) return res.status(404).json({ message: 'Article not found.' });

    res.json(item);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to load help article.' });
  }
};

export const listHelpFaqs = async (_req: Request, res: Response) => {
  try {
    const faqs = await HelpFaq.find({ isPublished: true }).sort({ order: 1, createdAt: -1 }).lean();
    res.json(faqs);
  } catch (e: any) {
    res.status(500).json({ message: e?.message || 'Failed to load FAQs.' });
  }
};
