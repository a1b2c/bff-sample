import { Duration } from 'aws-cdk-lib';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';

export type Stage = 'dev' | 'staging' | 'prod';

/** Everything that differs between environments. Stacks read this instead of checking the stage. */
export interface EnvironmentConfig {
  readonly stage: Stage;
  /** Placeholder IDs: this project is validated by synth, tests and policy checks, never deployed. */
  readonly account: string;
  readonly region: string;
  /** Shift traffic to new Lambda versions gradually, rolling back on alarm. */
  readonly canary: boolean;
  /** Retain data and block deletes, so removing a stack can't lose it. */
  readonly protectData: boolean;
  readonly backups: boolean;
  readonly logRetention: RetentionDays;
  readonly throttle: { readonly rateLimit: number; readonly burstLimit: number };
  readonly alertEmail: string;
  /** Provided by the organization's landing zone, not this repo. */
  readonly permissionsBoundaryName: string;
}

const shared = {
  region: 'us-east-1',
  alertEmail: 'platform-alerts@example.com',
  permissionsBoundaryName: 'ecom-workload-boundary',
};

export const environments: Record<Stage, EnvironmentConfig> = {
  dev: {
    ...shared,
    stage: 'dev',
    account: '111111111111',
    canary: false,
    protectData: false,
    backups: false,
    logRetention: RetentionDays.TWO_WEEKS,
    throttle: { rateLimit: 50, burstLimit: 100 },
  },
  staging: {
    ...shared,
    stage: 'staging',
    account: '222222222222',
    canary: true,
    protectData: false,
    backups: false,
    logRetention: RetentionDays.ONE_MONTH,
    throttle: { rateLimit: 100, burstLimit: 200 },
  },
  prod: {
    ...shared,
    stage: 'prod',
    account: '333333333333',
    canary: true,
    protectData: true,
    backups: true,
    logRetention: RetentionDays.ONE_YEAR,
    throttle: { rateLimit: 1_000, burstLimit: 2_000 },
  },
};

/** Looks up a stage from CDK context, failing on a typo instead of deploying to the wrong place. */
export function resolveEnvironment(stage: unknown = 'dev'): EnvironmentConfig {
  if (stage === 'dev' || stage === 'staging' || stage === 'prod') return environments[stage];
  throw new Error(`Unknown stage ${JSON.stringify(stage)}: use dev, staging or prod`);
}

/** Lambda's limit for one request: longer than the DB client's 3 attempts at 3s, plus backoff. */
export const LAMBDA_TIMEOUT = Duration.seconds(15);

/** Share of requests allowed to fail: a 99.9% availability target. */
export const SLO_ERROR_BUDGET = 0.001;
