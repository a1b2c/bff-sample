import { Annotations, type IAspect, Stack } from 'aws-cdk-lib';
import { CfnGlobalTable, CfnTable } from 'aws-cdk-lib/aws-dynamodb';
import type { IConstruct } from 'constructs';

interface RecoverySetting {
  readonly pointInTimeRecoveryEnabled?: unknown;
}

/**
 * Fails synth for a table that can't be restored, however it was created.
 * `addError` on purpose: unlike a cdk-nag finding, this cannot be acknowledged.
 */
export class RequireTableRecovery implements IAspect {
  visit(node: IConstruct) {
    if (!(node instanceof CfnTable || node instanceof CfnGlobalTable)) return;
    if (!this.settings(node).every((s) => s?.pointInTimeRecoveryEnabled === true)) {
      Annotations.of(node).addError('Every table must have point-in-time recovery enabled');
    }
  }

  /** A table's recovery settings, resolved since `TableV2` builds its replicas lazily. A global table has one per replica. */
  private settings(table: CfnTable | CfnGlobalTable): (RecoverySetting | undefined)[] {
    const stack = Stack.of(table);
    if (table instanceof CfnTable) {
      return [stack.resolve(table.pointInTimeRecoverySpecification) as RecoverySetting | undefined];
    }
    const replicas = stack.resolve(table.replicas) as {
      pointInTimeRecoverySpecification?: RecoverySetting;
    }[];
    return replicas.map((replica) => replica.pointInTimeRecoverySpecification);
  }
}
