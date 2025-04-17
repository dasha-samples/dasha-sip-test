Simple application based on Dasha.ai SDK for node.js for testing SIP connections.

> **IMPORTANT DISCLAIMER:** This application and the examples provided are for demonstration, testing, and educational purposes only. They are not intended for production use without proper security review and hardening. In production environments, you should implement proper authentication, encryption, input validation, and other security best practices.

# Prerequisites:
- node.js 18.0 and above
- dasha cli `npm i -g @dasha.ai/cli`
- logged in account using `dasha-cli`: `dasha account login default`
- access to an configuration of your PBX or SIP/PSTN/telephony provider

# How to use

- clone this repository
- `npm сi`

## Outbound calls checking

- Create inbound SIP configuration on your PBX/provider
- Create outbound SIP configuration on Dasha side
    - `dasha sip create-outbound -h`
    - for example: 
```
dasha sip create-outbound --server my-dasha-app.pstn.twilio.com --account +1XXXXXXXXXX --ask-password twilio
password: enter_your_password_here
```
- Call to yourself `node index.js out -c twilio -i endpoint=+XXXXXX --`
- More info: https://docs.dasha.ai/en-us/default/tutorials/sip-outbound-calls/


## Inbound calls checking

- Create inbound SIP configuration on Dasha side
`dasha sip create-inbound --application-name sip-test-app sip-test-app`
- Command will return SIP `uri`, you need to call
- Create outbound SIP configuration on PBX/provider side
- `node index.js in`
- Wait for line: `Waiting for calls via SIP`
- Call to `uri` returned by `dasha sip create-inbound`
- More info: https://docs.dasha.ai/en-us/default/tutorials/sip-inbound-calls/

## HTTP Server

- Run HTTP server to handle conversation requests via API
- The server will listen for HTTP POST requests and trigger Dasha conversations

`node index.js httpserver --port 8080 -c twilio`

- Send JSON data to the server with POST requests to `/conversation` endpoint
- Example using curl:
```
curl -X POST http://localhost:8080/conversation \
  -H "Content-Type: application/json" \
  -d '{"endpoint": "+1XXXXXXXXXX"}'
```

### Authentication Options

- Secure your HTTP server with token authentication:

`node index.js httpserver -c twilio --tokens token1 token2 --`

- When using tokens, include them in your requests:
```
curl -X POST http://localhost:8080/conversation \
  -H "Authorization: Bearer token1" \
  -H "Content-Type: application/json" \
  -d '{"endpoint": "+1XXXXXXXXXX"}'
```
- Alternatively, you can use a query parameter:
```
curl -X POST "http://localhost:8080/conversation?token=token1" \
  -H "Content-Type: application/json" \
  -d '{"endpoint": "+1XXXXXXXXXX"}'
```

### Webhook Support

- Send conversation results to external systems:
```
node index.js httpserver -w https://your-webhook.com/endpoint -wt webhook-token
```
- This will send POST requests with conversation results to your endpoint
- The `-wt` option adds an Authorization header with the specified token

### External Functions

## Chat Mode

- Run interactive text chat with Dasha AI instead of voice calls
- This lets you test your conversational flows directly from the terminal
```
node index.js chat
```

- Type your messages and press Enter to send them to the AI
- The AI's responses will appear in the console
- To exit the chat, enter an empty line (just press Enter)

### Chat Command Options

The chat command supports these options:
- `-a, --application-path <application>`: Path to application (default: "./app")
- `-i, --input-data <inputs...>`: Input data in format key=value
- `-v, --verbose`: Show all logs
- `-d, --debug-logs`: Show debug logs
- `-e, --externals <path>`: Path to external functions
- `-w, --webhook <url>`: Webhook URL to send results
- `-wt, --webhook-token <token>`: Token for webhook authentication

Example:
```
node index.js chat 
```

### Common Options for All Commands

All commands support these common options:

- `-c, --sip-config <sip>`: SIP config name (default: "default")
- `-t, --tts-config <tts>`: TTS config name
- `-s, --stt-config <stt>`: STT config name
- `-g, --group <group>`: Group name (default: "Default")
- `-c, --concurrency <concurrency>`: Concurrency (default: "1")
- `-a, --application-path <application>`: Path to application (default: "./app")
- `-i, --input-data <inputs...>`: Input data in format key=value
- `-v, --verbose`: Show all logs
- `-d, --debug-logs`: Show debug logs
- `-t, --transcript`: Show transcript
- `-e, --externals <path>`: Path to external functions
- `-w, --webhook <url>`: Webhook URL to send results
- `-wt, --webhook-token <token>`: Token for webhook authentication

Example with multiple options:

```
node index.js httpserver -c twilio -p 3000 --tokens token1 token2 -- -w https://example.com/webhook -wt secret -e ./externals.js  --
```

Note: Use the `--` at the end of the command when using multiple input values with `-i` to prevent option parsing conflicts.

## Checking call forwarding

This program allows you to check call forwarding

```
node index.js out -c twilio -i endpoint=+XXXXXX forward=forward-phone --
node index.js in -i forward=forward-phone --
```

In the end of the dialog, your call will be forwarded to `forward-phone`.

## Accessing to custom headers for incoming calls

DSL call `#getConnectOptions` returns a dictionary with connection options discovered after an `#connect` or `#connectSafe` call.

Example result:
```json
{
  "options":
    {
      "sip_domain": "dashatesttrunk.pstn.twilio.com",
      "sip_fromUser": "hello",
      "sip_displayName": "hello",
      "sip_X_Twilio_AccountSid": "ACXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "sip_X_Twilio_CallSid": "CAXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "sip_x_call_id": "XXXXXX-XXXXX-XXXXX-XXXXX-XXXXXXXXXXXXX",
    },
}
```

X-headers are available with prefix `sip_` and replacement `-` to `_`


### Notes:

Forwarded calls are not tracked by Dasha, and are implemented using a `SIP REFER` message


Happy checking!!

---
dasha.ai team

https://dasha.ai















