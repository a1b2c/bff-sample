import { RemovalPolicy, Stack, type StackProps, Validations } from 'aws-cdk-lib';
import { BackupPlan, BackupResource, BackupVault } from 'aws-cdk-lib/aws-backup';
import { AttributeType, BillingMode, Table, TableEncryption } from 'aws-cdk-lib/aws-dynamodb';
import { Key } from 'aws-cdk-lib/aws-kms';
import type { LoadedFeatureManifest } from '@repo/feature-manifest';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments.ts';

export interface DataStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly features: readonly LoadedFeatureManifest[];
}

/** Stateful resources, apart from the code that uses them: redeploying the API can't touch data. */
export class DataStack extends Stack {
  /** Every table, by the name features use for it in `feature.json`. */
  readonly tables = new Map<string, Table>();

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config, features } = props;
    const removalPolicy = config.protectData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const key = new Key(this, 'DataKey', {
      description: `Encrypts ecom ${config.stage} data`,
      enableKeyRotation: true,
      removalPolicy,
    });

    const tableNames = new Set(features.flatMap((f) => f.table ?? []));
    for (const tableName of tableNames) {
      const table = new Table(this, `${tableName}Table`, {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
        sortKey: { name: 'sk', type: AttributeType.STRING },
        billingMode: BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: key,
        pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
        deletionProtection: config.protectData,
        removalPolicy,
      });
      this.tables.set(tableName, table);
    }

    if (config.backups) {
      const vault = new BackupVault(this, 'Vault', { encryptionKey: key, removalPolicy });
      const plan = BackupPlan.dailyMonthly1YearRetention(this, 'Backups', vault);
      const selection = plan.addSelection('Tables', {
        resources: [...this.tables.values()].map((t) => BackupResource.fromDynamoDbTable(t)),
      });
      Validations.of(selection).acknowledge({
        id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup]',
        reason: "AWS Backup's own policy, kept up to date by AWS as it adds supported services.",
      });
    }
  }
}
