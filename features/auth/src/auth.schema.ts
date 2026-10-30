import { z } from 'zod';

export const PingResponse = z.object({
  status: z.literal('ok'),
  feature: z.literal('auth'),
});
