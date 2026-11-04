import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const designers = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/designers' }),
  schema: ({ image }) =>
    z.object({
      order: z.number(),
      name: z.string(),
      gender: z.enum(['m', 'f', 'pl']),
      monogram: z.string(),
      photo: image(),
      country: z.string(),
      hook: z.string(),
      pronounce: z.string().optional(),
      quote: z.string().optional(),
      quoteBy: z.string().optional(),
      lead: z.string(),
      known: z.string(),
      trick: z.string(),
      story: z.string(),
      signature: z.array(z.string()),
      extra: z.array(z.object({ title: z.string(), text: z.string() })).optional(),
      icon: z.string(),
      works: z.string(),
      why: z.string(),
      toggles: z.object({
        discipline: z.array(z.enum(['architecture', 'interior', 'object', 'decor'])),
        region: z.enum(['ua', 'world']),
        era: z.enum(['classic', 'now']),
      }),
    }),
});

const pages = defineCollection({
  loader: glob({ pattern: '*.md', base: './src/content/pages' }),
  schema: z.object({ title: z.string() }),
});

export const collections = { designers, pages };
