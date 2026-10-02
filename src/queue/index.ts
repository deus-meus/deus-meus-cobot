import { type ConnectionOptions, Queue } from "bullmq";
import { env } from "../config/env";

export const redisConnection: ConnectionOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
};

export interface WebhookJobData {
  deliveryId: string;
  eventName: string;
  action?: string;
  repository: string;
  installationId?: number;
  payload: Record<string, unknown>;
}

export const webhookQueue = new Queue<WebhookJobData>("webhook-jobs", {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: true,
    removeOnFail: false,
  },
});
