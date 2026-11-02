import { Duration, RemovalPolicy, Validations } from 'aws-cdk-lib';
import { type HttpApi, HttpMethod } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import {
  AlarmRule,
  CompositeAlarm,
  GraphWidget,
  type IWidget,
  MathExpression,
  type Metric,
  TreatMissingData,
} from 'aws-cdk-lib/aws-cloudwatch';
import { SnsAction } from 'aws-cdk-lib/aws-cloudwatch-actions';
import { LambdaDeploymentConfig, LambdaDeploymentGroup } from 'aws-cdk-lib/aws-codedeploy';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { Alias, Architecture, Runtime, Tracing } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { FilterPattern, LogGroup, MetricFilter } from 'aws-cdk-lib/aws-logs';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import { type LoadedFeatureManifest, publicPath } from '@repo/feature-manifest';
import { Construct } from 'constructs';
import { join } from 'node:path';
import {
  type EnvironmentConfig,
  LAMBDA_TIMEOUT,
  SLO_ERROR_BUDGET,
} from '../config/environments.ts';
import { REPO_ROOT } from '../config/features.ts';

/** How much faster than sustainable the error budget may burn: 14.4x spends 2% of a 30-day budget in an hour. */
const SLO_FAST_BURN_RATE = 14.4;

/**
 * Share of failing requests that stops a rollout. The alarm sees both versions, so with 10% of
 * traffic on the new one it trips once about 1 in 10 of the new version's requests fail.
 */
const ROLLBACK_ERROR_RATE = 0.01;

export interface FeatureServiceProps {
  readonly feature: LoadedFeatureManifest;
  readonly config: EnvironmentConfig;
  readonly api: HttpApi;
  readonly alerts: ITopic;
  /** The feature's table, when its manifest asks for one. */
  readonly table?: Table | undefined;
}

/**
 * The golden path: everything one feature needs to run safely in production,
 * from its `feature.json` alone. A Lambda, least-privilege access, routes,
 * alarms and gradual rollouts, the same for every feature.
 */
export class FeatureService extends Construct {
  /** The feature's dashboard row. */
  readonly widgets: IWidget[];

  constructor(scope: Construct, id: string, props: FeatureServiceProps) {
    super(scope, id);
    const { feature, config, api, alerts, table } = props;

    const logGroup = new LogGroup(this, 'Logs', {
      retention: config.logRetention,
      removalPolicy: config.protectData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    // A role of our own instead of the default: AWS's managed logging policy can write to any log group
    const role = new Role(this, 'Role', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      description: `Runs the ecom ${config.stage} ${feature.name} feature`,
    });
    logGroup.grantWrite(role);

    const fn = new NodejsFunction(this, 'Fn', {
      entry: feature.entry,
      projectRoot: REPO_ROOT,
      depsLockFilePath: join(REPO_ROOT, 'pnpm-lock.yaml'),
      runtime: Runtime.NODEJS_24_X,
      architecture: Architecture.ARM_64,
      memorySize: 512,
      timeout: LAMBDA_TIMEOUT,
      role,
      logGroup,
      tracing: Tracing.ACTIVE,
      environment: {
        NODE_OPTIONS: '--enable-source-maps',
        ...(table && { TABLE_NAME: table.tableName }),
      },
      bundling: {
        format: OutputFormat.ESM, // The handlers use top-level await
        target: 'node24',
        minify: true,
        sourceMap: true,
        sourcesContent: false,
        externalModules: [], // Ship the SDK versions in the lockfile, not the runtime's
        // Bundled CommonJS packages require() Node's built-ins, and ESM has no require
        banner:
          "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
      },
    });
    table?.grantReadWriteData(fn);
    Validations.of(role).acknowledge({
      id: 'AwsSolutions-IAM5[Resource::*]',
      reason: 'X-Ray trace writes have no resource to scope to.',
    });
    if (table) {
      const reason =
        "CDK's table grant, limited to the actions a read-write role needs on one key.";
      Validations.of(role).acknowledge(
        { id: 'AwsSolutions-IAM5[Action::kms:ReEncrypt*]', reason },
        { id: 'AwsSolutions-IAM5[Action::kms:GenerateDataKey*]', reason },
      );
    }

    const alias = new Alias(this, 'Live', { aliasName: 'live', version: fn.currentVersion });

    // Fastify answers exceptions with a 500, a successful invocation to Lambda: its Errors metric
    // only sees crashes and timeouts, so 5xx responses are counted from the request logs.
    const serverErrors: Metric = new MetricFilter(this, 'ServerErrors', {
      logGroup,
      filterPattern: FilterPattern.numberValue('$.res.statusCode', '>=', 500),
      metricNamespace: `Ecom/${config.stage}`,
      metricName: `${feature.name}-5xx`,
      metricValue: '1',
      defaultValue: 0,
    }).metric({ statistic: 'Sum', period: Duration.minutes(1) });

    if (config.canary) {
      // Only stops the rollout, with no alert: the SLO alarm below is what notifies people
      const rollbackAlarm = this.errorRate(Duration.minutes(1), serverErrors, alias).createAlarm(
        this,
        'RollbackAlarm',
        {
          alarmDescription: `${feature.name} is failing too many requests to continue a rollout`,
          threshold: ROLLBACK_ERROR_RATE,
          evaluationPeriods: 1,
          treatMissingData: TreatMissingData.NOT_BREACHING,
        },
      );
      const canary = new LambdaDeploymentGroup(this, 'Canary', {
        alias,
        alarms: [rollbackAlarm],
        deploymentConfig: LambdaDeploymentConfig.CANARY_10PERCENT_5MINUTES,
      });
      Validations.of(canary).acknowledge({
        id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSCodeDeployRoleForLambdaLimited]',
        reason: "CodeDeploy's own limited policy, added by CDK for shifting Lambda traffic.",
      });
    }

    const sloBurn = new CompositeAlarm(this, 'SloBurnAlarm', {
      alarmDescription: `${feature.name} is using up its 30-day error budget ${SLO_FAST_BURN_RATE}x too fast`,
      // Both windows: the long one proves it matters, the short one that it is still happening
      alarmRule: AlarmRule.allOf(
        this.burnRateAlarm('SloBurnShort', Duration.minutes(5), serverErrors, alias),
        this.burnRateAlarm('SloBurnLong', Duration.hours(1), serverErrors, alias),
      ),
    });
    sloBurn.addAlarmAction(new SnsAction(alerts));

    const integration = new HttpLambdaIntegration('Integration', alias);
    const path = publicPath(feature);
    const routes = [path, `${path}/{proxy+}`].flatMap((routePath) =>
      api.addRoutes({ path: routePath, methods: [HttpMethod.ANY], integration }),
    );
    for (const route of routes) {
      Validations.of(route).acknowledge({
        id: 'AwsSolutions-APIG4',
        reason: "Authorization is the job of the feature's Lambda handler, not API Gateway.",
      });
    }

    this.widgets = [
      new GraphWidget({
        title: `${feature.name}: requests and 5xx`,
        left: [alias.metricInvocations()],
        right: [serverErrors],
      }),
      new GraphWidget({
        title: `${feature.name}: p99 latency`,
        left: [alias.metricDuration({ statistic: 'p99' })],
      }),
      new GraphWidget({
        title: `${feature.name}: crashes and throttles`,
        left: [alias.metricErrors(), alias.metricThrottles()],
      }),
    ];
  }

  /** Share of requests that failed: crashes and timeouts never log a response, so they're added. */
  private errorRate(period: Duration, serverErrors: Metric, alias: Alias) {
    return new MathExpression({
      expression: 'IF(requests > 0, (FILL(errors, 0) + FILL(crashes, 0)) / requests, 0)',
      usingMetrics: {
        errors: serverErrors.with({ period }),
        crashes: alias.metricErrors({ period }),
        requests: alias.metricInvocations({ period }),
      },
      period,
    });
  }

  private burnRateAlarm(id: string, period: Duration, serverErrors: Metric, alias: Alias) {
    return this.errorRate(period, serverErrors, alias).createAlarm(this, id, {
      threshold: SLO_FAST_BURN_RATE * SLO_ERROR_BUDGET,
      evaluationPeriods: 1,
      treatMissingData: TreatMissingData.NOT_BREACHING,
    });
  }
}
