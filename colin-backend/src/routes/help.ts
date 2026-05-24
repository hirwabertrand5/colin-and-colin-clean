import express from 'express';
import {
  listHelpCategories,
  listHelpArticles,
  getHelpArticleById,
  listHelpFaqs,
} from '../controllers/helpController';

const router = express.Router();

// Public-ish (still behind auth in UI; you can add authenticate if you want)
router.get('/help/categories', listHelpCategories);
router.get('/help/articles', listHelpArticles);
router.get('/help/articles/:id', getHelpArticleById);
router.get('/help/faqs', listHelpFaqs);

export default router;