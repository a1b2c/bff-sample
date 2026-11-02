import { App } from 'aws-cdk-lib';
import { resolveEnvironment } from '../lib/config/environments.ts';
import { addEcomStacks } from '../lib/ecom-app.ts';
import { loadFeatures } from '../lib/config/features.ts';

// Pick an environment with: cdk synth -c stage=prod
const app = new App();
const config = resolveEnvironment(app.node.tryGetContext('stage'));

addEcomStacks(app, config, loadFeatures());
