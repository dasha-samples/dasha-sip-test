const commander = require("commander");
const dasha = require("@dasha.ai/sdk");

commander
  .command("out")
  .description("check calls from Dasha")
  .requiredOption("-p --phone <phone>", "phone or SIP URI to call to")
  .option("-c --config <name>", "SIP config name", "default")
  .option("-f --forward <phone>", "phone or SIP URI to forward the call to")
  .action(async ({ phone, config, forward }) => {
    const app = await dasha.deploy("./app");

    app.connectionProvider = () =>
      dasha.sip.connect(new dasha.sip.Endpoint(config));
    app.ttsDispatcher = () => "dasha";

    await app.start();

    const conv = app.createConversation({ phone, forward: forward ?? null });
    await conv.execute();

    await app.stop();
    app.dispose();
  });

commander
  .command("in")
  .description("check calls to Dasha")
  .option("-f --forward <phone>", "phone or SIP URI to forward the call to")
  .action(async ({ forward }) => {
    const app = await dasha.deploy("./app");

    app.connectionProvider = () =>
      dasha.sip.connect(new dasha.sip.Endpoint("default"));
    app.ttsDispatcher = () => "dasha";

    app.queue.on("ready", async (conv) => {
      conv.input = { phone: null, forward: forward ?? null };
      await conv.execute();

      await app.stop();
      app.dispose();
    });

    await app.start();

    console.log("Waiting for calls via SIP");
    console.log("Press Ctrl+C to exit");
    console.log(
      "More details: https://docs.dasha.ai/en-us/default/tutorials/sip-inbound-calls/"
    );
    console.log("Or just type:");
    console.log(
      "dasha sip create-inbound --application-name dtmf-test-app dtmf-test-app"
    );
    console.log("And call to sip uri returned by command above");
  });

commander.parseAsync();
