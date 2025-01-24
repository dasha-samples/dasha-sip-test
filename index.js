const commander = require("commander");
const dasha = require("@dasha.ai/sdk");

async function configureJobProcessor(app, sipConfig, forward, verbose, stopAfterOneJob) {
  app.queue.on("timeout", (key, jobId) => {
    console.log(`Job ${jobId} and ${key} was timedout`);
  });

  app.queue.on("rejected", (key, error, jobId) => {
    console.warn(`Job ${jobId} and ${key} was rejected by SDK with error: ${error}`);
  });

  app.queue.on("ready", async (id, conv, info) => {
    if (info.sip !== undefined) {
      console.log(`Captured sip call: ${JSON.stringify(info.sip)}`);
      conv.input.forward = forward;
    }

    console.log(`Ready ${id} with args '${JSON.stringify(conv.input)}'`);
    if (verbose === true) {
      conv.on("debugLog", console.log);
    }
    conv.sip.config = sipConfig;

    try {
      const result = await conv.execute();
      console.log(JSON.stringify(result));
    } catch (e) {
      console.error(`Runtime error of job ${id}: `, e);
    } finally {
      if (stopAfterOneJob) {
        await stop(app);
        process.exit(0);
      }
    }
  });
}

commander
  .command("out")
  .description("check calls from Dasha")
  .requiredOption("-p --phone <phone>", "phone or SIP URI to call to")
  .option("-c --config <name>", "SIP config name", "default")
  .option("-f --forward <phone>", "phone or SIP URI to forward the call to")
  .option("-v --verbose", "Show debug logs")
  .action(async ({ phone, config, forward, verbose }) => {
    const app = await dasha.deploy("./app");
    configureHandlers(app);
    configureJobProcessor(app, config, forward, verbose, true);
    await app.start({ concurrency: 1 });

    const serverData = await app.queue.push("my-key", {
      before: new Date(Date.now() + 60 * 60 * 1000),
      input: {
        endpoint: phone,
        forward: forward ?? null
      }
    });

    console.log(`Pushed to queue with internal id: ${serverData.jobId}`);
    console.log("Press Ctrl+C to exit");
  });

commander
  .command("in")
  .description("check calls to Dasha")
  .option("-f --forward <phone>", "phone or SIP URI to forward the call to")
  .option("-v --verbose", "Show debug logs")
  .action(async ({ forward, verbose }) => {
    const groupName = "Default";
    const app = await dasha.deploy("./app", { groupName: groupName });
    configureHandlers(app);
    configureJobProcessor(app, "default", forward, verbose, false);

    await app.start({ concurrency: 1 });

    console.log("Waiting for calls via SIP");

    const configs = Object.values((await dasha.sip.inboundConfigs.listConfigs()));
    const thisConfigs = configs.filter((x) => x.applicationName === app.applicationName && x.groupName === groupName);
    if (thisConfigs.length > 0) {
      thisConfigs.forEach(x => console.log(x.uri));
      thisConfigs.filter(x => x.aliasUri !== null && x.aliasUri !== undefined).forEach(x => console.log(x.aliasUri));
    }

    console.log("Press Ctrl+C to exit");
    console.log(
      "More details: https://docs.dasha.ai/en-us/default/tutorials/sip-inbound-calls/"
    );
    console.log("Or just type:");
    console.log(
      `dasha sip create-inbound --application-name "${app.applicationName}" --group-name "${groupName}" "${app.applicationName}-${groupName}"`
    );
    console.log("And call to sip uri returned by command above");
  });

commander.parseAsync().catch(async (e) => {
  console.error(e);
  process.exit(12);
});

var stopped = false;

async function stop(app) {
  try {
    if (!stopped) {
      stopped = true;
      await app?.stop({ waitUntilAllProcessed: true });
      await app?.dispose();
    }
  } catch (e) {
    console.error(`App encountered an error - Exception on stopping app ${e}`);
  }
}

// Configure process exit handlers for graceful stopping of the application
function configureProcessHandlers(app) {
  process.once("unhandledRejection", async (reason) => {
    console.error(`App encountered an error - unhandled Rejection ${reason}`);
    await stop(app);
    process.exit(12);
  });

  process.once("SIGINT", async () => {
    console.warn(`SIGINT trapped. Gracefully closing NODE...`);
    await stop(app);
    process.exit(130);
  });

  process.once("SIGTERM", async () => {
    console.warn(`SIGTERM trapped. Closing NODE... gracefully...`);
    await stop(app);
    process.exit(143);
  });

  process.once("uncaughtException", async (reason) => {
    console.error(`App encountered an error - uncaught Exception ${reason}`);
    await stop(app);
    process.exit(12);
  });
}

// configure application handlers 
function configureErrorHandlers(app) {
  app.on("error", (key, error, jobId) => {
    console.error(`Job ${jobId} and ${key} was failed with error: ${error}`);
  });

  app.on("unableToReconnect", (e) => {
    console.error(`Failed to reconect to dasha.ai platform, exiting`, e);
    process.exit(12);
  });
}

function configureHandlers(app) {
  configureProcessHandlers(app);
  configureErrorHandlers(app);
}
