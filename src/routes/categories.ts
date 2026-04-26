import { Router, Response } from 'express';
import prisma from '../services/prisma';

const router = Router();

router.get('/', async (_req, res: Response) => {
  const categories = await prisma.category.findMany({
    orderBy: { name: 'asc' },
  });
  res.json(categories);
});

export default router;