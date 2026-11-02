import { Aspects, type Stack, Tags } from 'aws-cdk-lib';
import { ManagedPolicy, PermissionsBoundary } from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments.ts';
import { RequireTableRecovery } from './require-table-recovery.ts';

/** Organization-wide rules, applied across every stack so no feature can opt out. */
export function applyGovernance(
  scope: Construct,
  stacks: readonly Stack[],
  config: EnvironmentConfig,
) {
  Tags.of(scope).add('project', 'ecom');
  Tags.of(scope).add('stage', config.stage);
  Tags.of(scope).add('managed-by', 'cdk');

  Aspects.of(scope).add(new RequireTableRecovery());

  // Caps what any role here can do, even if a grant is too broad
  for (const stack of stacks) {
    const boundary = ManagedPolicy.fromManagedPolicyName(
      stack,
      'PermissionsBoundary',
      config.permissionsBoundaryName,
    );
    PermissionsBoundary.of(stack).apply(boundary);
  }
}
