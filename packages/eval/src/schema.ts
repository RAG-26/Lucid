import { z } from 'zod';

export const corpusSchema = z.enum(['kubernetes', 'docker', 'cross-corpus']);

export const unanswerableReasonSchema = z.enum(['adjacent-topic', 'false-premise', 'not-covered']);

export const questionSchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    split: z.enum(['dev', 'test']),
    answerable: z.boolean(),
    corpus: corpusSchema,
    category: z.string().min(1),
    goldSources: z.array(z.string()),
    unanswerableReason: unanswerableReasonSchema.optional(),
    referenceAnswer: z.string().optional(),
  })
  .refine((q) => q.answerable || q.unanswerableReason !== undefined, {
    message: 'unanswerableReason is required when answerable is false',
  });

export type Question = z.infer<typeof questionSchema>;
