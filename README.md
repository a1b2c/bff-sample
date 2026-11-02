# ecom-backend

An e-commerce backend built as a pnpm monorepo. Each feature is a Fastify plugin that runs as its own AWS Lambda behind one HTTP API, and all the AWS infrastructure is defined with CDK.

## Quick start

You need Node 24 (see `.nvmrc`) and Corepack or pnpm 12.

```bash
pnpm install
```

```bash
pnpm dev
```

```bash
curl http://localhost:4000/v1/catalog/ping
```

`pnpm dev` serves every feature from one local process, on `PORT` (default 4000).

## Layout

| Path                        | What it holds                                                               |
| --------------------------- | --------------------------------------------------------------------------- |
| `features/*`                | One folder per feature: `feature.json`, routes, service, repository, tests  |
| `packages/fastify-core`     | `buildApp`, `createFeatureHandler`, shared error handling                   |
| `packages/database`         | DynamoDB client, exposed to a feature as `app.db`                           |
| `packages/feature-manifest` | Schema and loader for `feature.json`                                        |
| `tools/dev-server`          | The local server behind `pnpm dev`                                          |
| `infra`                     | CDK app: stacks, the `FeatureService` construct, governance rules and tests |

## Commands

Run these from the repo root.

| Command                | What it does                                                 |
| ---------------------- | ------------------------------------------------------------ |
| `pnpm dev`             | Start the local server, restarting on changes                |
| `pnpm test`            | Run all tests once                                           |
| `pnpm test:watch`      | Run tests in watch mode                                      |
| `pnpm typecheck`       | Type-check every package                                     |
| `pnpm lint`            | Run ESLint (`pnpm lint:fix` to fix what it can)              |
| `pnpm format`          | Format with Prettier (`pnpm format:check` to only check)     |
| `pnpm check`           | Typecheck, lint, format check and tests; the pre-commit hook |
| `pnpm infra:test`      | Run only the infra tests                                     |
| `pnpm infra:synth`     | Synthesize the CloudFormation templates                      |
| `pnpm infra:diff`      | Compare the stacks with what is deployed                     |
| `pnpm infra:deploy`    | Deploy all of a stage's stacks                               |
| `pnpm infra:bootstrap` | Bootstrap CDK in the target account                          |

## Features

A feature describes itself in `feature.json`:

```json
{
  "name": "auth",
  "version": "v1",
  "prefix": "/auth",
  "handler": "src/auth.handler.ts",
  "table": "auth"
}
```

| Field     | Meaning                                                                                                       |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| `name`    | Used for AWS resource names                                                                                   |
| `version` | API version; with `prefix` it forms the public path, here `/v1/auth`                                          |
| `prefix`  | Path under the version                                                                                        |
| `handler` | Lambda entry file, relative to the feature folder                                                             |
| `table`   | Optional DynamoDB table. Features naming the same table share it. Its name reaches the Lambda as `TABLE_NAME` |

### Adding a feature

1. Copy `features/catalog` to `features/<name>`, then rename its package and update `feature.json`.
2. Run `pnpm install` to link the new package.
3. Add the feature to `tools/dev-server/src/server.ts`, and to that package's dependencies, so `pnpm dev` serves it.
4. Update `infra/test/stacks.test.ts`, which has expectations written for today's two features.

Infra needs no code change: `infra/lib/config/features.ts` finds every folder in `features/` and gives each one a Lambda, least-privilege IAM role, routes, alarms and a dashboard row.

## Infrastructure

The CDK app creates three stacks per stage, named `ecom-<stage>-<stack>`:

| Stack           | Contents                                                                                              |
| --------------- | ----------------------------------------------------------------------------------------------------- |
| `observability` | Encrypted SNS topic and email subscription for alerts                                                 |
| `data`          | DynamoDB tables, their KMS key and, where enabled, AWS Backup                                         |
| `api`           | HTTP API, access logs, dashboard and one `FeatureService` per feature (Lambda, alias, routes, alarms) |

Stages are defined in `infra/lib/config/environments.ts`:

| Setting                           | `dev`    | `staging` | `prod`        |
| --------------------------------- | -------- | --------- | ------------- |
| Canary rollout via CodeDeploy     | No       | Yes       | Yes           |
| Retain data, block deletion       | No       | No        | Yes           |
| AWS Backup                        | No       | No        | Yes           |
| Log retention                     | 2 weeks  | 1 month   | 1 year        |
| Throttle rate / burst (per route) | 50 / 100 | 100 / 200 | 1,000 / 2,000 |

Pick a stage with CDK context. It defaults to `dev`, and an unknown stage fails the command:

```bash
pnpm infra:synth -c stage=prod
```

Synthesizing runs `cdk-nag` (AWS Solutions rules) and the rules in `infra/lib/governance`. Findings that are accepted on purpose are acknowledged in the code next to the resource, with a reason.

### Before deploying

The project is currently validated by synth, tests and policy checks only. Deploying needs real values in `infra/lib/config/environments.ts`, which holds placeholders for:

- the AWS account IDs
- `alertEmail`, whose owner must also confirm the SNS subscription
- `permissionsBoundaryName`, an IAM policy that must already exist in each account, since this repo does not create it

API routes have no API Gateway authorizer: authorization is the job of each feature's handler.
