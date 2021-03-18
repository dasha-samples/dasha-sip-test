const dasha = require('@dasha.ai/platform-sdk');
const { options } = require('yargs');
const yargs = require('yargs');

function parseArgs() {
    const argv = yargs
        .command('out', 'Check calls from Dasha', {
            config: {
                description: 'Name of sip config',
                alias: 'c',
                type: 'string',
            },
            phone: {
                description: 'Phone you want to call, or sip uri (sip:XXX@YYY)',
                alias: 'p',
                type: 'string',
            },
            forward: {
                description: 'Phone you want to forward call to, or sip uri (sip:XXX@YYY)',
                alias: 'f',
                type: 'string',
            },
        })
        .command('in', "Check calls to Dasha", {
            forward: {
                description: 'Phone you want to forward call to, or sip uri (sip:XXX@YYY)',
                alias: 'f',
                type: 'string',
            },
        })
        .demandCommand(1, "You need to select in or out command")
        .help()
        .alias('help', 'h')
        .argv;
    return argv;
}

function createLogger() {
    return {
        log: async(msg) => {
            console.log({ Log: msg });
        },
        transcription: async(msg, incoming) => {
            console.log(incoming ? { Human: msg } : { AI: msg });
        },
        raw: async(devlog) => {
            if (devlog.msg.msgId === "FailedOpenSessionChannelMessage") {
                console.error(`Failed to call: ${devlog.msg.reason} ${devlog.msg.details}`);

            }
        }
    }
}

async function check(config, phone, forward) {
    if (forward === undefined)
        forward = null;
    let sdk = new dasha.DashaSdk(await dasha.accounts.getCurrentAccountInfo());
    let app = await sdk.registerApp({
        appPackagePath: "./app",
        concurrency: 1,
        progressReporter: dasha.progress.consoleReporter,
    });
    console.log(`instanceId: ${app.instanceId}`);
    await app.addSessionConfig({
        name: "audio",
        config: {
            type: "audio",
            channel: {
                type: "sip",
                configName: config
            },
            stt: {
                configName: "Default-en"
            },
            tts: {
                type: "synthesized",
                configName: "Dasha"
            }
        }
    });
    if (phone !== null) {
        console.log("Trying to call via SIP");
        let job = await app.startJob(phone, "audio", { data: { phone: phone, forward }, debugEvents: createLogger() });
        console.log("Job started");
        const result = await job.result;
        console.log("Job completed:", result);
        app.disconnect();
        return;
    } else {
        console.log("Waiting for calls via SIP");
        console.log("Press Ctrl+C to exit");
        console.log("More details: https://docs.dasha.ai/en-us/default/tutorials/sip-inbound-calls/");
        console.log("Or just type:");
        console.log("dasha sip create-inbound --application-name sip-test-app sip-test-app");
        console.log("And call to sip uri returned by command above");
        app.onJob({
            startingJob: async(serverId, id, incomingData) => {
                console.log(incomingData);
                const job = { data: { phone: "", forward: forward }, debugEvents: createLogger() };
                console.log(`Accept job ${id}`, job);
                return { accept: true, sessionConfigName: "audio", ...job };
            },
            completedJob: async(id, result) => {
                console.log(`Completed job ${id}`, result);
                app.disconnect();
                return;
            },
            failedJob: async(id, error) => {
                console.log(`Failed job ${id}`, error);
                app.disconnect();
                return;
            },
            timedOutJob: async(id) => {
                console.log(`Job ${id} timed out`);
                app.disconnect();
                return;
            },
        });
    }
}

async function main() {
    try {
        let account = await dasha.accounts.getCurrentAccountInfo();
    } catch {
        console.warn("Can't find you account");
        console.warn("Use https://www.npmjs.com/package/@dasha.ai/cli for login");
        process.exit(1);
    }
    let argv = parseArgs();
    if (argv._.includes('out')) {
        if (argv.config === undefined || argv.phone === undefined) {
            console.warn("config and phone number are required");
            process.exit(1);
        }
        await check(argv.config, argv.phone, argv.forward);
        return;
    }
    if (argv._.includes('in')) {
        await check("default", null, argv.forward);
        return;
    }
}


main();