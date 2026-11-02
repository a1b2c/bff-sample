import { App, Stack, Validations } from 'aws-cdk-lib';
import { Annotations, Match, Template } from 'aws-cdk-lib/assertions';
import { AttributeType, CfnTable, Table } from 'aws-cdk-lib/aws-dynamodb';
import { AwsSolutionsChecks } from 'cdk-nag';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { environments, resolveEnvironment, type Stage } from '../lib/config/environments.ts';
import { addEcomStacks } from '../lib/ecom-app.ts';
import { loadFeatures } from '../lib/config/features.ts';
import { RequireTableRecovery } from '../lib/governance/require-table-recovery.ts';

/** Bundling every Lambda with esbuild takes a few seconds per stage. */
const SYNTH_TIMEOUT = 180_000;

function synthStage(stage: Stage, features = loadFeatures()) {
  const app = new App();
  const stacks = addEcomStacks(app, environments[stage], features);
  return {
    app,
    stacks,
    api: Template.fromStack(stacks.api),
    data: Template.fromStack(stacks.data),
    observability: Template.fromStack(stacks.observability),
  };
}

type Synth = ReturnType<typeof synthStage>;

interface LambdaResource {
  Properties: { Environment: { Variables: Record<string, unknown> }; Role: unknown };
}

describe.each(['dev', 'staging', 'prod'] as const)('every stage: %s', (stage) => {
  let synth: Synth;
  beforeAll(() => {
    synth = synthStage(stage);
  }, SYNTH_TIMEOUT);

  it('passes cdk-nag: an unacknowledged finding would have failed synth', () => {
    expect(synth.app.synth().stacks).toHaveLength(3);
  });

  it('gives every feature a Lambda with the agreed runtime and limits', () => {
    synth.api.resourcePropertiesCountIs(
      'AWS::Lambda::Function',
      { Runtime: 'nodejs24.x', Architectures: ['arm64'], Timeout: 15 },
      loadFeatures().length,
    );
  });

  it('only gives a table to features that ask for one', () => {
    synth.data.resourceCountIs('AWS::DynamoDB::Table', 1);

    const lambdas = Object.values(
      synth.api.findResources('AWS::Lambda::Function'),
    ) as LambdaResource[];
    const withTable = lambdas.filter((l) => l.Properties.Environment.Variables.TABLE_NAME);
    expect(withTable).toHaveLength(1);
  });

  it('only lets a Lambda with a table reach DynamoDB', () => {
    const policies = Object.values(synth.api.findResources('AWS::IAM::Policy'));
    expect(policies.filter((p) => JSON.stringify(p).includes('dynamodb:'))).toHaveLength(1);
  });

  it('encrypts tables with a rotating customer-managed key, and can restore them', () => {
    synth.data.hasResourceProperties('AWS::DynamoDB::Table', {
      SSESpecification: { SSEEnabled: true, SSEType: 'KMS' },
      PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
    });
    synth.data.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
  });

  it('only uses API Gateway v2 resources', () => {
    expect(JSON.stringify(synth.api.toJSON())).not.toContain('AWS::ApiGateway::');
    synth.api.resourceCountIs('AWS::ApiGatewayV2::Api', 1);
  });

  it('routes both the bare path and everything under it', () => {
    for (const prefix of ['auth', 'catalog']) {
      synth.api.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: `ANY /v1/${prefix}`,
      });
      synth.api.hasResourceProperties('AWS::ApiGatewayV2::Route', {
        RouteKey: `ANY /v1/${prefix}/{proxy+}`,
      });
    }
    synth.api.resourceCountIs('AWS::ApiGatewayV2::Route', loadFeatures().length * 2);
  });

  it('sends traffic to the live alias, not directly to the function', () => {
    synth.api.resourceCountIs('AWS::Lambda::Alias', loadFeatures().length);
    synth.api.allResourcesProperties('AWS::Lambda::Permission', {
      FunctionName: Match.anyValue(),
      Principal: 'apigateway.amazonaws.com',
    });
  });

  it('protects the API with logs and throttling', () => {
    const { throttle } = environments[stage];
    synth.api.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      AccessLogSettings: { DestinationArn: Match.anyValue(), Format: Match.anyValue() },
      DefaultRouteSettings: {
        ThrottlingRateLimit: throttle.rateLimit,
        ThrottlingBurstLimit: throttle.burstLimit,
      },
    });
  });

  it('alarms on 5xx responses, which Lambda counts as successes', () => {
    synth.api.hasResourceProperties('AWS::Logs::MetricFilter', {
      FilterPattern: '{ $.res.statusCode >= 500 }',
    });
  });

  it('pages on a fast SLO burn over both time windows', () => {
    const alarms = Object.values(synth.api.findResources('AWS::CloudWatch::CompositeAlarm'));
    expect(alarms).toHaveLength(loadFeatures().length);
    for (const alarm of alarms) {
      const definition = JSON.stringify(alarm);
      expect(definition).toMatch(/SloBurnShort.*AND.*SloBurnLong/);
      expect(definition).toContain('AlarmActions');
    }
  });

  it('counts crashes and timeouts towards the SLO, which log no response', () => {
    const alarms = Object.entries(synth.api.findResources('AWS::CloudWatch::Alarm'));
    const burnAlarms = alarms.filter(([id]) => id.includes('SloBurn'));
    expect(burnAlarms).toHaveLength(loadFeatures().length * 2);
    for (const [, alarm] of burnAlarms) {
      const definition = JSON.stringify(alarm);
      expect(definition).toContain('FILL(crashes, 0)');
      expect(definition).toContain('"MetricName":"Errors"');
    }
  });

  it('only alerts from the SLO alarm, so one failed request notifies nobody', () => {
    const alarms = Object.values(synth.api.findResources('AWS::CloudWatch::Alarm'));
    expect(alarms.filter((a) => JSON.stringify(a).includes('AlarmActions'))).toHaveLength(0);
  });

  it('lets CloudWatch publish to the alerts topic, whose policy replaces the default', () => {
    synth.observability.hasResourceProperties('AWS::SNS::TopicPolicy', {
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Allow',
            Principal: { Service: 'cloudwatch.amazonaws.com' },
            Action: 'sns:Publish',
            Condition: { StringEquals: { 'aws:SourceAccount': environments[stage].account } },
          }),
        ]),
      },
    });
  });

  it('caps every IAM role with the permissions boundary', () => {
    const templates = [synth.api, synth.data, synth.observability];
    const roles = templates.flatMap((t) => Object.values(t.findResources('AWS::IAM::Role')));
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(JSON.stringify(role)).toContain('PermissionsBoundary');
    }
  });

  it('tags resources with their stage', () => {
    synth.data.hasResourceProperties('AWS::DynamoDB::Table', {
      Tags: Match.arrayWith([{ Key: 'stage', Value: stage }]),
    });
  });
});

describe('differences between stages', () => {
  let dev: Synth;
  let staging: Synth;
  let prod: Synth;
  beforeAll(() => {
    dev = synthStage('dev');
    staging = synthStage('staging');
    prod = synthStage('prod');
  }, SYNTH_TIMEOUT);

  it('rolls out gradually in staging and prod, with automatic rollback', () => {
    for (const { api } of [staging, prod]) {
      api.resourceCountIs('AWS::CodeDeploy::DeploymentGroup', loadFeatures().length);
      api.allResourcesProperties('AWS::CodeDeploy::DeploymentGroup', {
        AutoRollbackConfiguration: {
          Enabled: true,
          Events: Match.arrayWith(['DEPLOYMENT_STOP_ON_ALARM']),
        },
        AlarmConfiguration: { Enabled: true, Alarms: Match.anyValue() },
        DeploymentConfigName: 'CodeDeployDefault.LambdaCanary10Percent5Minutes',
      });
    }
  });

  it('rolls back on an error rate, not on a single failed request', () => {
    for (const { api } of [staging, prod]) {
      const rollbackAlarms = Object.entries(api.findResources('AWS::CloudWatch::Alarm')).filter(
        ([id]) => id.includes('RollbackAlarm'),
      );
      expect(rollbackAlarms).toHaveLength(loadFeatures().length);
      for (const [, alarm] of rollbackAlarms) {
        expect(JSON.stringify(alarm)).toContain('FILL(crashes, 0)');
      }
      api.resourcePropertiesCountIs(
        'AWS::CloudWatch::Alarm',
        { Threshold: 0.01 },
        loadFeatures().length,
      );
    }
  });

  it('skips the canary in dev', () => {
    dev.api.resourceCountIs('AWS::CodeDeploy::DeploymentGroup', 0);
    const alarmIds = Object.keys(dev.api.findResources('AWS::CloudWatch::Alarm'));
    expect(alarmIds.filter((id) => id.includes('RollbackAlarm'))).toHaveLength(0);
  });

  it('protects prod data from deletion', () => {
    prod.data.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      Properties: { DeletionProtectionEnabled: true },
    });
    expect(prod.stacks.data.terminationProtection).toBe(true);
  });

  it('lets dev data be thrown away', () => {
    dev.data.hasResource('AWS::DynamoDB::Table', { DeletionPolicy: 'Delete' });
    expect(dev.stacks.data.terminationProtection).toBe(false);
  });

  it('backs up prod only', () => {
    prod.data.resourceCountIs('AWS::Backup::BackupPlan', 1);
    dev.data.resourceCountIs('AWS::Backup::BackupPlan', 0);
    staging.data.resourceCountIs('AWS::Backup::BackupPlan', 0);
  });
});

describe('access control', () => {
  it(
    'leaves authorization to the Lambda handlers, with no authorizer on any route',
    () => {
      const { api } = synthStage('dev');
      api.resourceCountIs('AWS::ApiGatewayV2::Authorizer', 0);
      api.resourcePropertiesCountIs(
        'AWS::ApiGatewayV2::Route',
        { AuthorizationType: 'NONE' },
        loadFeatures().length * 2,
      );
    },
    SYNTH_TIMEOUT,
  );
});

describe('table sharing', () => {
  function synthWithOrders(table: string) {
    const auth = loadFeatures().find((f) => f.name === 'auth')!;
    const orders = { ...auth, name: 'orders', prefix: '/orders', table };
    const { api, data } = synthStage('dev', [auth, orders]);
    const lambdas = Object.values(api.findResources('AWS::Lambda::Function')) as LambdaResource[];
    const policies = Object.values(api.findResources('AWS::IAM::Policy'));
    return {
      data,
      tableNames: lambdas.map((l) => l.Properties.Environment.Variables.TABLE_NAME),
      withDynamoAccess: policies.filter((p) => JSON.stringify(p).includes('dynamodb:')),
    };
  }

  it(
    'creates one table for features naming the same one, and gives each access to it',
    () => {
      const { data, tableNames, withDynamoAccess } = synthWithOrders('auth');
      data.resourceCountIs('AWS::DynamoDB::Table', 1);
      expect(tableNames).toHaveLength(2);
      expect(tableNames[0]).toEqual(tableNames[1]);
      expect(withDynamoAccess).toHaveLength(2);
    },
    SYNTH_TIMEOUT,
  );

  it(
    'creates separate tables for different names',
    () => {
      const { data, tableNames } = synthWithOrders('orders');
      data.resourceCountIs('AWS::DynamoDB::Table', 2);
      expect(tableNames[0]).not.toEqual(tableNames[1]);
    },
    SYNTH_TIMEOUT,
  );
});

describe('guardrails catch bad infrastructure', () => {
  it('fails synth on an unacknowledged cdk-nag finding', () => {
    const appWithBadTable = () => {
      const app = new App();
      const stack = new Stack(app, 'Bad');
      new Table(stack, 'NoRecovery', {
        partitionKey: { name: 'pk', type: AttributeType.STRING },
      });
      return app;
    };

    // The same app synthesizes without cdk-nag, so cdk-nag is what fails it
    expect(() => appWithBadTable().synth()).not.toThrow();

    const checked = appWithBadTable();
    Validations.of(checked).addPlugins(new AwsSolutionsChecks(checked));
    expect(() => checked.synth()).toThrow();
  });

  it('flags a table that has no point-in-time recovery', () => {
    const app = new App();
    const stack = new Stack(app, 'Bad');
    const table = new CfnTable(stack, 'NoRecovery', {
      keySchema: [{ attributeName: 'pk', keyType: 'HASH' }],
    });
    new RequireTableRecovery().visit(table);

    Annotations.fromStack(stack).hasError('*', Match.stringLikeRegexp('point-in-time recovery'));
  });

  it('rejects an unknown stage', () => {
    expect(() => resolveEnvironment('production')).toThrow(/Unknown stage "production"/);
    expect(resolveEnvironment().stage).toBe('dev');
  });
});

describe('built Lambda bundles', () => {
  let bundles: string[];
  beforeAll(() => {
    const { directory } = synthStage('dev').app.synth();
    bundles = readdirSync(directory)
      .map((name) => join(directory, name, 'index.mjs'))
      .filter((file) => existsSync(file));
  }, SYNTH_TIMEOUT);

  /** Loads a bundle the way Lambda does, a real ES module with no `require`, and calls its handler. */
  function callRoutes(bundle: string, paths: string[]) {
    const script = `
      const { handler } = await import(${JSON.stringify(pathToFileURL(bundle).href)});
      const statuses = [];
      for (const path of ${JSON.stringify(paths)}) {
        const event = {
          version: '2.0',
          rawPath: path,
          rawQueryString: '',
          headers: {},
          requestContext: { http: { method: 'GET', path, sourceIp: '127.0.0.1' } },
        };
        statuses.push((await handler(event, {})).statusCode);
      }
      console.log('STATUSES=' + statuses.join(','));
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      env: { ...process.env, AWS_REGION: 'us-east-1' },
    });
    expect(result.stderr).not.toMatch(/Dynamic require/);
    return /STATUSES=(.*)/.exec(result.stdout)?.[1];
  }

  it('builds one bundle per feature', () => {
    expect(bundles).toHaveLength(loadFeatures().length);
  });

  it('each serves its own routes and no one else', () => {
    const results = bundles.map((b) => callRoutes(b, ['/v1/auth/ping', '/v1/catalog/ping']));
    expect(results.sort()).toEqual(['200,404', '404,200']);
  }, 60_000);
});
