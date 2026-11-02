import { type App, Validations } from 'aws-cdk-lib';
import type { LoadedFeatureManifest } from '@repo/feature-manifest';
import { AwsSolutionsChecks } from 'cdk-nag';
import { ApiStack } from './stacks/api-stack.ts';
import type { EnvironmentConfig } from './config/environments.ts';
import { DataStack } from './stacks/data-stack.ts';
import { applyGovernance } from './governance/apply-governance.ts';
import { ObservabilityStack } from './stacks/observability-stack.ts';

/** Adds one environment's stacks to `app`. Shared by `bin/app.ts` and the tests. */
export function addEcomStacks(
  app: App,
  config: EnvironmentConfig,
  features: readonly LoadedFeatureManifest[],
) {
  const base = {
    config,
    env: { account: config.account, region: config.region },
    terminationProtection: config.protectData,
  };
  const name = (stack: string) => `ecom-${config.stage}-${stack}`;

  const observability = new ObservabilityStack(app, name('observability'), base);
  const data = new DataStack(app, name('data'), { ...base, features });
  const api = new ApiStack(app, name('api'), {
    ...base,
    features,
    tables: data.tables,
    alerts: observability.alerts,
  });

  applyGovernance(app, [observability, data, api], config);
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));

  return { observability, data, api };
}
