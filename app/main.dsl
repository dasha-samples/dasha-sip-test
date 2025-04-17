context {
    input endpoint: string = "";
    input forward: string? = null;
}

external function exampleExternal():string;

start node root
{
    do
    {
        #log(external exampleExternal());
        #connectSafe($endpoint, {
            vad: "asap_v1"
        });
        #log(#getConnectOptions());
        #waitForSpeech(1000);
        #sayText("Hello");
        if ($forward is not null) {
            #sayText("Press one to forward");
        }
        wait *;
    }
    transitions
    {
        respond: goto respond on true;
    }
}

node respond
{
    do
    {
        #sayText(#getMessageText());
        wait *;
    } transitions {
        respond: goto respond on true;
    }
}

digression dtmf {
    conditions { on #getDTMF() is not null tags: onprotocol; }
    do {
        #log("Received keypad press: " + (#getDTMF() ?? ""));
        if ($forward is not null && #getDTMF() == "1")
        {
            var response = #forwardSync($forward);
            if (response.success) {
                #log("Forward succeed");
            } else {
                #log("Forward failed");
            }
            exit;
        }
        return;
    }
}

digression exit_dig
{
    conditions { on true tags: onclosed; }
    do
    {
        #log("Hangup by user");
        exit;
    }
}
