const commander = require("commander");
const dasha = require("@dasha.ai/sdk");
const express = require('express');
const bodyParser = require('body-parser');
const https = require('https');
const http = require('http');
const url = require('url');
const readline = require('readline');

/**
 * Parses input data from command line arguments
 * 
 * @param {string[]} inputData - Array of strings in format "key=value"
 * @returns {object} Dictionary of parsed input parameters
 */
function parseInputData(inputData) {
  var inputDict = {};
  for (let input of inputData ?? []) {
    let splitted = input.split("=");
    if (splitted.length !== 2) {
      throw new Error("Invalid input data. Must be in format key=value");
    }
    inputDict[splitted[0]] = splitted[1];
  }
  return inputDict;
}

/**
 * Sets up and deploys the Dasha application with the given configuration
 * 
 * @param {string} applicationPath - Path to the Dasha application
 * @param {string} group - Group name for the application
 * @param {string} sip - SIP configuration name
 * @param {string} tts - TTS configuration name
 * @param {string} stt - STT configuration name
 * @param {object} inputDict - Dictionary of input parameters
 * @param {boolean} verbose - Whether to show verbose logs
 * @param {boolean} debugLogs - Whether to show debug logs
 * @param {boolean} transcript - Whether to show conversation transcript
 * @param {boolean} stopAfterOneJob - Whether to stop after processing one job
 * @param {number} concurrency - Number of concurrent jobs to process
 * @param {string} pathToExternals - Path to external functions
 * @param {string} webhookUrl - URL to send results to
 * @param {string} webhookToken - Token for webhook authentication
 * @param {boolean} isChat - Whether to run in chat mode
 * @returns {object} The deployed Dasha application
 */
async function setupDashaApp(applicationPath, group, sip, tts, stt,
  inputDict, verbose, debugLogs, transcript, stopAfterOneJob,
  concurrency, pathToExternals, webhookUrl, webhookToken, isChat) {
  
  // Deploy the application
  const app = await dasha.deploy(applicationPath ?? "./app", {
    groupName: group,
  });

  // Load external functions
  if (pathToExternals) {
    // Load from specified path
    const lib = require(pathToExternals); //as { [x: string]: (args: any, conv: any) => unknown; };
    for (const funcName in lib) {
      app.setExternal(funcName, lib[funcName]);
    }
  } else {
    // Try to load from default location
    const lib = require("./externals"); //as { [x: string]: (args: any, conv: any) => unknown; };
    for (const funcName in lib) {
      app.setExternal(funcName, lib[funcName]);
    }
  }

  // Configure application handlers
  configureHandlers(app);
  
  // Configure logging
  if (verbose) {
    debugLogs = debugLogs ?? true;
    transcript = transcript ?? true;
  }

  // Disable transcript in chat mode since we'll display messages differently
  if (isChat) {
    transcript = false;
  }

  // Configure job processor with all settings
  configureJobProcessor(app, sip ?? "default", tts, stt, inputDict, verbose, debugLogs, transcript, stopAfterOneJob, webhookUrl, webhookToken, isChat);

  // Start the application with specified concurrency
  await app.start({ concurrency: parseInt(concurrency) ?? 1 });
  
  return app;
}

/**
 * Sends data to a webhook endpoint
 * 
 * @param {string} webhookUrl - URL to send data to
 * @param {string} webhookToken - Authentication token for the webhook
 * @param {object} data - Data to send to the webhook
 * @returns {Promise} Promise that resolves when the webhook call is complete
 */
async function sendToWebhook(webhookUrl, webhookToken, data) {
  return new Promise((resolve, reject) => {
    try {
      // Skip if no webhook URL is provided
      if (!webhookUrl) {
        resolve();
        return;
      }

      // Parse URL and determine if HTTPS should be used
      const parsedUrl = url.parse(webhookUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const options = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (isHttps ? 443 : 80),
        path: parsedUrl.path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      };
      
      // Add authorization token if provided
      if (webhookToken) {
        options.headers['Authorization'] = `Bearer ${webhookToken}`;
      }

      // Prepare the data
      const requestData = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(requestData);

      // Make the request
      const req = (isHttps ? https : http).request(options, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => {
          responseBody += chunk;
        });
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            dasha.log.log("info", `Webhook sent successfully to ${webhookUrl}`);
            resolve();
          } else {
            dasha.log.log("error", `Webhook failed with status ${res.statusCode}: ${responseBody}`);
            resolve(); // Still resolve to not block the process
          }
        });
      });

      req.on('error', (error) => {
        dasha.log.log("error", `Error sending webhook to ${webhookUrl}: ${error.message}`);
        resolve(); // Still resolve to not block the process
      });

      req.write(requestData);
      req.end();
    } catch (error) {
      dasha.log.log("error", `Error sending webhook: ${error.message}`);
      resolve(); // Still resolve to not block the process
    }
  });
}

/**
 * Configures the job processor for the Dasha application
 * This is the core function that handles conversations and processes jobs
 * 
 * @param {object} app - The Dasha application
 * @param {string} sip - SIP configuration name
 * @param {string} tts - TTS configuration name
 * @param {string} stt - STT configuration name
 * @param {object} inputDict - Dictionary of input parameters
 * @param {boolean} verbose - Whether to show verbose logs
 * @param {boolean} debugLogs - Whether to show debug logs
 * @param {boolean} transcript - Whether to show conversation transcript
 * @param {boolean} stopAfterOneJob - Whether to stop after processing one job
 * @param {string} webhookUrl - URL to send results to
 * @param {string} webhookToken - Token for webhook authentication
 * @param {boolean} isChat - Whether to run in chat mode
 */
async function configureJobProcessor(app, sip, tts,
  stt, inputDict, verbose,
  debugLogs, transcript, stopAfterOneJob,
  webhookUrl, webhookToken, isChat) {
  
  // Handle job timeouts
  app.queue.on("timeout", (key, jobId) => {
    dasha.log.log("info", `Job ${jobId} and ${key} was timedout`);
  });

  // Handle job rejections
  app.queue.on("rejected", (key, error, jobId) => {
    dasha.log.log("warn", `Job ${jobId} and ${key} was rejected by SDK with error: ${error}`);
  });

  // Handle ready jobs (main conversation handler)
  app.queue.on("ready", async (id, conv, info) => {
    // Log SIP call information if available
    if (info.sip !== undefined) {
      dasha.log.log("info", `Captured sip call: ${JSON.stringify(info.sip)}`);
    }

    // Merge input parameters with conversation input
    conv.input = { ...(conv.input ?? {}), ...inputDict };

    // Configure TTS if specified
    if (tts) {
      conv.tts.config = tts;
    }

    // Configure STT if specified
    if (stt) {
      conv.stt.config = stt;
    }

    // Configure transcript logging if enabled
    if (transcript) {
      conv.on("transcript", (transcript) => {
        dasha.log.log("info", `${transcript.name ?? transcript.speaker}: ${transcript.text}`);
      });
    }
    
    dasha.log.log("info", `Ready ${id} with args '${JSON.stringify(conv.input)}'`);

    // Configure debug logging if enabled
    if (debugLogs) {
      conv.on("debugLog", (msg) => dasha.log.log("debug", msg));
    }

    // Set SIP configuration
    conv.sip.config = sip ?? "Default"

    try {
      // Handle chat mode specially
      if (isChat) {
        // Create a chat interface for text-based conversation
        const chat = await dasha.chat.createChat(conv);
        const interface = readline.createInterface(process.stdin);
        console.log("To stop chat print empty line");
        
        // Handle user input
        // Here exampele of recieve message from console and send it to Dasha
        // For example, it can be replaced on integration recieve message from webpage/whatsapp/telegram/etc
        interface.on("line", async (text) => {
          if (text === "") {
            console.log("Chat stopped");
            await chat.close();
            interface.close();
          }
          await chat.sendTextAndReceiveResponse(text).catch((error) => dasha.log.log("error", error));
        });
        
        // Handle AI responses from Dasha and send it to console
        chat.on("gluedText", (text) => {
          // Here can be a logic to send message to anywere
          // For example, to a chat bot on webpage
          // Or telegram/whatsapp/etc
          // Or to any other chat bot
          if (text !== "") {
            console.log(`AI: ${text}`);
          }
        });
      }
      
      // Execute the conversation
      const result = await conv.execute({ channel: isChat ? "text" : "audio" });

      // Send results to webhook if URL is provided
      if (webhookUrl) {
        await sendToWebhook(webhookUrl, webhookToken, {
          jobId: conv._jobId,
          result,
          timestamp: new Date().toISOString(),
          input: conv.input,
          info
        });
      }
      dasha.log.log("info", `Inspect at: https://playground.dasha.ai/inspector/${conv.jobId}`);
    } catch (e) {
      dasha.log.log("error", `Runtime error of job ${id}: ${e}`);
      dasha.log.log("error", `Inspect at: https://playground.dasha.ai/inspector/${conv.jobId}`);
      // Send error to webhook if URL is provided
      if (webhookUrl) {
        await sendToWebhook(webhookUrl, webhookToken, {
          jobId: conv._jobId,
          error: e.message || String(e),
          timestamp: new Date().toISOString(),
          input: conv.input,
          info
        });
      }
    } finally {
      // Stop the application if configured to stop after one job
      if (stopAfterOneJob) {
        await stop(app);
        process.exit(0);
      }
    }
  });
}

// Define and configure CLI commands using commander

/**
 * OUT command
 * Makes outbound calls from Dasha
 */
commander
  .command("out")
  .description("single call from Dasha (Outbound)")
  .option("-c --sip-config <sip>", "SIP config name", "default")
  .option("-t --tts-config <tts>", "TTS config name", undefined)
  .option("-s --stt-config <stt>", "STT config name", undefined)
  .option("-a --application-path <application>", "Path to application from executing directory", "./app")
  .option("-i --input-data <inputs...>", "Input data in format key=value", [])
  .option("-v --verbose", "Show all logs", "false")
  .option("-d --debug-logs", "Show debug logs", "false")
  .option("-t --transcript", "Show transcript", "false")
  .option("-e --externals <path>", "Path to external functions", undefined)
  .option("-w --webhook <url>", "Webhook URL to send results", undefined)
  .option("-wt --webhook-token <token>", "Token for webhook authentication", undefined)
  .action(async ({ sipConfig, ttsConfig, sttConfig, applicationPath, inputData, verbose, debugLogs, transcript, externals, webhook, webhookToken }) => {
    const inputDict = parseInputData(inputData);
    const app = await setupDashaApp(applicationPath, undefined, sipConfig, ttsConfig, sttConfig, inputDict, verbose, debugLogs, transcript, true, 1, externals, webhook, webhookToken, false);

    // Queue a job for outbound call
    const serverData = await app.queue.push("my-key", {
      before: new Date(Date.now() + 60 * 60 * 1000),
      input: inputDict
    });

    dasha.log.log("info", `Pushed to queue with internal id: ${serverData.jobId}`);
    dasha.log.log("info", "Press Ctrl+C to exit");
  });

/**
 * CHAT command
 * Starts an interactive text chat with Dasha AI
 */
commander
  .command("chat")
  .description("single chat from Dasha (Outbound)")
  .option("-a --application-path <application>", "Path to application from executing directory", "./app")
  .option("-i --input-data <inputs...>", "Input data in format key=value", [])
  .option("-v --verbose", "Show all logs", "false")
  .option("-d --debug-logs", "Show debug logs", "false")
  .option("-e --externals <path>", "Path to external functions", undefined)
  .option("-w --webhook <url>", "Webhook URL to send results", undefined)
  .option("-wt --webhook-token <token>", "Token for webhook authentication", undefined)
  .action(async ({ applicationPath, inputData, verbose, debugLogs, externals, webhook, webhookToken }) => {
    const inputDict = parseInputData(inputData);
    // Set up app with chat mode enabled
    const app = await setupDashaApp(applicationPath, undefined, undefined, undefined, undefined, inputDict, verbose, debugLogs, false, true, 1, externals, webhook, webhookToken, true);

    // Queue a job for chat
    const serverData = await app.queue.push("my-key", {
      before: new Date(Date.now() + 60 * 60 * 1000),
      input: inputDict
    });

    dasha.log.log("info", `Pushed to queue with internal id: ${serverData.jobId}`);
    dasha.log.log("info", "Press Ctrl+C to exit");
  });

/**
 * IN command
 * Handles inbound calls to Dasha
 */
commander
  .command("in")
  .description("Calls to Dasha (Inbound)")
  .option("-c --sip-config <sip>", "SIP config name", "default")
  .option("-t --tts-config <tts>", "TTS config name", undefined)
  .option("-s --stt-config <stt>", "STT config name", undefined)
  .option("-g --group <group>", "Group name", "Default")
  .option("-c --concurrency <concurrency>", "Concurrency", "1")
  .option("-a --application-path <application>", "Path to application from executing directory", "./app")
  .option("-i --input-data <inputs...>", "Input data in format key=value", [])
  .option("-v --verbose", "Show all logs")
  .option("-d --debug-logs", "Show debug logs")
  .option("-t --transcript", "Show transcript")
  .option("-e --externals <path>", "Path to external functions", undefined)
  .option("-w --webhook <url>", "Webhook URL to send results", undefined)
  .option("-wt --webhook-token <token>", "Token for webhook authentication", undefined)
  .action(async ({ sipConfig, ttsConfig, sttConfig, group, concurrency, applicationPath, inputData, verbose, debugLogs, transcript, externals, webhook, webhookToken }) => {
    const inputDict = parseInputData(inputData);
    const app = await setupDashaApp(applicationPath, group, sipConfig, ttsConfig, sttConfig, inputDict, verbose, debugLogs, transcript, false, concurrency, externals, webhook, webhookToken, false);

    dasha.log.log("info", "Waiting for calls via SIP");

    // List available SIP configurations
    const configs = Object.values((await dasha.sip.inboundConfigs.listConfigs()));
    const thisConfigs = configs.filter((x) => x.applicationName === app.applicationName && x.groupName === group);
    if (thisConfigs.length > 0) {
      thisConfigs.forEach(x => dasha.log.log("info", x.uri));
      thisConfigs.filter(x => x.aliasUri !== null && x.aliasUri !== undefined).forEach(x => dasha.log.log("info", x.aliasUri));
    }

    dasha.log.log("info", "Press Ctrl+C to exit");
    dasha.log.log("info", "More details: https://docs.dasha.ai/en-us/default/tutorials/sip-inbound-calls/");
    dasha.log.log("info", "Or just type:");
    dasha.log.log("info", `dasha sip create-inbound --application-name "${app.applicationName}" --group-name "${group}" "${app.applicationName}-${group}"`);
    dasha.log.log("info", "And call to sip uri returned by command above");
  });

/**
 * HTTPSERVER command
 * Starts an HTTP server for handling conversation requests via API
 */
commander
  .command("httpserver")
  .description("Start Express HTTP server for Dasha")
  .option("-p --port <port>", "HTTP server port", "8080")
  .option("-c --sip-config <sip>", "SIP config name", "default")
  .option("-t --tts-config <tts>", "TTS config name", undefined)
  .option("-s --stt-config <stt>", "STT config name", undefined)
  .option("-g --group <group>", "Group name", "Default")
  .option("-c --concurrency <concurrency>", "Concurrency", "1")
  .option("-a --application-path <application>", "Path to application from executing directory", "./app")
  .option("-i --input-data <inputs...>", "Input data in format key=value", [])
  .option("-v --verbose", "Show all logs")
  .option("-d --debug-logs", "Show debug logs")
  .option("-t --transcript", "Show transcript")
  .option("--tokens <tokens...>", "List of allowed authentication tokens", [])
  .option("-e --externals <path>", "Path to external functions", undefined)
  .option("-w --webhook <url>", "Webhook URL to send results", undefined)
  .option("-wt --webhook-token <token>", "Token for webhook authentication", undefined)
  .action(async ({ port, sipConfig, ttsConfig, sttConfig, group, concurrency, applicationPath, inputData, verbose, debugLogs, transcript, tokens, externals, webhook, webhookToken }) => {
    const inputDict = parseInputData(inputData);
    const app = await setupDashaApp(applicationPath, group, sipConfig, ttsConfig, sttConfig, inputDict, verbose, debugLogs, transcript, false, concurrency, externals, webhook, webhookToken, false);

    // Create Express app
    const expressApp = express();
    expressApp.use(bodyParser.json());
    expressApp.use(bodyParser.urlencoded({ extended: true }));

    // Token authentication middleware
    const authMiddleware = (req, res, next) => {
      // Skip token validation if no tokens are specified
      if (!tokens || tokens.length === 0) {
        return next();
      }
      
      // Get token from Authorization header or query parameter
      const authHeader = req.headers.authorization;
      const queryToken = req.query.token;
      
      let token = null;
      
      // Extract token from Authorization header (Bearer token)
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      } else if (queryToken) {
        // Use token from query parameter
        token = queryToken;
      }
      
      // Check if token is in the allowed tokens list
      if (token && tokens.includes(token)) {
        return next();
      }
      
      // Token is invalid or not provided
      res.status(401).json({
        status: 'error',
        message: 'Unauthorized: Invalid or missing token'
      });
    };

    // Define routes
    // Homepage route
    expressApp.get('/', (req, res) => {
      res.send('Dasha Express Server is running. Send POST requests to /conversation to start a conversation.');
    });

    // Conversation endpoint
    expressApp.post('/conversation', authMiddleware, async (req, res) => {
      try {
        dasha.log.log("info", `Received HTTP request with data: ${JSON.stringify(req.body)}`);
        
        // Queue a job with request data merged with default inputs
        const serverData = await app.queue.push("http-request", {
          before: new Date(Date.now() + 60 * 60 * 1000),
          input: { ...inputDict, ...req.body }
        });
        
        // Return success response with job ID
        res.status(200).json({
          status: 'success',
          message: 'Request processed',
          jobId: serverData.jobId
        });
      } catch (error) {
        dasha.log.log("error", `Error processing request: ${error}`);
        res.status(400).json({ status: 'error', message: error.message });
      }
    });

    // Start Express server
    expressApp.listen(parseInt(port), () => {
      dasha.log.log("info", `Express server running at http://localhost:${port}/`);
      dasha.log.log("info", "Send POST requests to /conversation endpoint to trigger Dasha conversations");
      if (tokens && tokens.length > 0) {
        dasha.log.log("info", `Authentication enabled with ${tokens.length} token(s)`);
        dasha.log.log("info", "Provide token as Bearer token in Authorization header or as ?token= query parameter");
      } else {
        dasha.log.log("info", "Authentication disabled (no tokens specified)");
      }
      if (webhook) {
        dasha.log.log("info", `Conversation results will be sent to webhook: ${webhook}`);
      }

      dasha.log.log("info", `Example using curl:
      "
        curl -X POST http://localhost:8080/conversation -H "Content-Type: application/json" -d '{"endpoint": "+1XXXXXXXXXX"}'
      "`)
      dasha.log.log("info", "Press Ctrl+C to exit");
    });
  });

// Handle errors in parsing CLI arguments
commander.parseAsync().catch(async (e) => {
  dasha.log.log("error", e);
  process.exit(12);
});

// Keep track of whether we've stopped the app already
var stopped = false;

/**
 * Stops the Dasha application gracefully
 * 
 * @param {object} app - The Dasha application to stop
 */
async function stop(app) {
  try {
    if (!stopped) {
      stopped = true;
      await app?.stop({ waitUntilAllProcessed: true });
      await app?.dispose();
    }
  } catch (e) {
    dasha.log.log("error", `App encountered an error - Exception on stopping app ${e}`);
  }
}

/**
 * Configures process exit handlers for graceful stopping of the application
 * 
 * @param {object} app - The Dasha application to configure handlers for
 */
function configureProcessHandlers(app) {
  // Handle unhandled promise rejections
  process.once("unhandledRejection", async (reason) => {
    dasha.log.log("error", `App encountered an error - unhandled Rejection ${reason}`);
    await stop(app);
    process.exit(12);
  });

  // Handle SIGINT (Ctrl+C)
  process.once("SIGINT", async () => {
    dasha.log.log("warn", `SIGINT trapped. Gracefully closing NODE...`);
    await stop(app);
    process.exit(130);
  });

  // Handle SIGTERM
  process.once("SIGTERM", async () => {
    dasha.log.log("warn", `SIGTERM trapped. Closing NODE... gracefully...`);
    await stop(app);
    process.exit(143);
  });

  // Handle uncaught exceptions
  process.once("uncaughtException", async (reason) => {
    dasha.log.log("error", `App encountered an error - uncaught Exception ${reason}`);
    await stop(app);
    process.exit(12);
  });
}

/**
 * Configures error handlers for the Dasha application
 * 
 * @param {object} app - The Dasha application to configure handlers for
 */
function configureErrorHandlers(app) {
  // Handle job errors
  app.on("error", (key, error, jobId) => {
    dasha.log.log("error", `Job ${jobId} and ${key} was failed with error: ${error}`);
  });

  // Handle reconnection failures
  app.on("unableToReconnect", (e) => {
    dasha.log.log("error", `Failed to reconect to dasha.ai platform, exiting ${e}`);
    process.exit(12);
  });
}

/**
 * Configures all handlers for the Dasha application
 * 
 * @param {object} app - The Dasha application to configure handlers for
 */
function configureHandlers(app) {
  configureProcessHandlers(app);
  configureErrorHandlers(app);
}
