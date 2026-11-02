import { Stack, type StackProps } from 'aws-cdk-lib';
import { PolicyStatement, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Key } from 'aws-cdk-lib/aws-kms';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments.ts';

export interface ObservabilityStackProps extends StackProps {
  readonly config: EnvironmentConfig;
}

/** Where alarms go. Deployed before the API, whose alarms publish to it. */
export class ObservabilityStack extends Stack {
  // Public so ApiStack can point its alarms at this topic
  readonly alerts: Topic;

  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);
    const { config } = props;

    // Our own KMS key for the topic, one per environment, rotated automatically
    const key = new Key(this, 'AlertsKey', {
      description: `Encrypts ecom ${config.stage} alerts`,
      enableKeyRotation: true,
    });
    // CloudWatch has to encrypt what it publishes, or alarm notifications are silently dropped
    key.grant(
      new ServicePrincipal('cloudwatch.amazonaws.com'),
      'kms:Decrypt',
      'kms:GenerateDataKey*',
    );

    // Messages are encrypted at rest with the key above; requests without HTTPS are denied
    this.alerts = new Topic(this, 'Alerts', { masterKey: key, enforceSSL: true });

    // enforceSSL's policy replaces the default one, which is what let CloudWatch publish
    this.alerts.addToResourcePolicy(
      new PolicyStatement({
        principals: [new ServicePrincipal('cloudwatch.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.alerts.topicArn],
        // Only alarms in this account can publish, not CloudWatch alarms from other accounts
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    );
    // Emails every alert; nothing arrives until the recipient confirms the subscription
    this.alerts.addSubscription(new EmailSubscription(config.alertEmail));
  }
}
