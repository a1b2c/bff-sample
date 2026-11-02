import { Annotations, type IAspect } from 'aws-cdk-lib';
import { CfnTable } from 'aws-cdk-lib/aws-dynamodb';
import type { IConstruct } from 'constructs';

/** Fails synth for a table that can't be restored, however it was created. */
export class RequireTableRecovery implements IAspect {
  visit(node: IConstruct) {
    if (node instanceof CfnTable && !node.pointInTimeRecoverySpecification) {
      Annotations.of(node).addError('Every table must have point-in-time recovery');
    }
  }
}
