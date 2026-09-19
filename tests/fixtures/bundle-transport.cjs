// Test-only transport interception. Production exposes no endpoint/remote override.
const childProcess = require('node:child_process');
const originalSpawn = childProcess.spawn;
childProcess.spawn = function (command, args, options) {
  if (command === 'git') args = args.map(arg => arg === 'https://github.com/acme/example.git' ? process.env.FIXTURE_REMOTE : arg);
  return originalSpawn.call(this, command, args, options);
};
globalThis.fetch = async (url) => {
  if (url !== 'https://api.typesafe.ai/v1/systemone') throw new Error('Unexpected network request in test');
  if (!process.env.FIXTURE_RESPONSE) throw new Error('Unexpected semantic request in test');
  return new Response(process.env.FIXTURE_RESPONSE, { status: 200 });
};
