import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { CfnStage, HttpApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { Dashboard, GraphWidget } from 'aws-cdk-lib/aws-cloudwatch';
import type { Table } from 'aws-cdk-lib/aws-dynamodb';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import type { ITopic } from 'aws-cdk-lib/aws-sns';
import type { LoadedFeatureManifest } from '@repo/feature-manifest';
import type { Construct } from 'constructs';
import type { EnvironmentConfig } from '../config/environments.ts';
import { FeatureService } from '../constructs/feature-service.ts';

export interface ApiStackProps extends StackProps {
  readonly config: EnvironmentConfig;
  readonly features: readonly LoadedFeatureManifest[];
  readonly tables: ReadonlyMap<string, Table>;
  readonly alerts: ITopic;
}

/** The stateless API: one HTTP API, and a {@link FeatureService} per feature. Safe to redeploy. */
export class ApiStack extends Stack {
  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, features, tables, alerts } = props;

    const accessLogs = new LogGroup(this, 'AccessLogs', {
      retention: config.logRetention,
      removalPolicy: config.protectData ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
    });

    const api = new HttpApi(this, 'Api', {
      apiName: `ecom-${config.stage}`,
      createDefaultStage: false,
    });
    // The default stage, not one named after config.stage: a named stage's prefix stays in the
    // path Lambda receives, and the adapter only strips it from REST events, so Fastify would 404
    // CfnStage, not api.addStage: a custom log format there needs AccessLogFormat from the v1 module
    new CfnStage(this, 'DefaultStage', {
      apiId: api.apiId,
      stageName: '$default',
      autoDeploy: true,
      defaultRouteSettings: {
        detailedMetricsEnabled: true,
        throttlingRateLimit: config.throttle.rateLimit,
        throttlingBurstLimit: config.throttle.burstLimit,
      },
      accessLogSettings: {
        destinationArn: accessLogs.logGroupArn,
        format: JSON.stringify({
          requestId: '$context.requestId',
          ip: '$context.identity.sourceIp',
          requestTime: '$context.requestTime',
          httpMethod: '$context.httpMethod',
          routeKey: '$context.routeKey',
          status: '$context.status',
          protocol: '$context.protocol',
          responseLength: '$context.responseLength',
          integrationError: '$context.integrationErrorMessage',
        }),
      },
    });

    const services = features.map(
      (feature) =>
        new FeatureService(this, feature.name, {
          feature,
          config,
          api,
          alerts,
          table: feature.table ? tables.get(feature.table) : undefined,
        }),
    );

    const dashboard = new Dashboard(this, 'Dashboard', {
      dashboardName: `ecom-${config.stage}`,
    });
    dashboard.addWidgets(
      new GraphWidget({
        title: 'API: requests and errors',
        left: [api.metricCount()],
        right: [api.metricClientError(), api.metricServerError()],
      }),
      new GraphWidget({ title: 'API: latency', left: [api.metricLatency({ statistic: 'p99' })] }),
    );
    for (const service of services) dashboard.addWidgets(...service.widgets);
  }
}
